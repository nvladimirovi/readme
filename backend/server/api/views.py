import io
import os
import multiprocessing
import subprocess
import base64
import time
import sys
import signal

from threading import Thread, Event
from multiprocessing import Process, Lock

from pathlib import Path

from django.http import FileResponse

from rest_framework import viewsets, status
from rest_framework.response import Response

from pydub import AudioSegment
from server.settings import BASE_DIR
from datetime import datetime

# Signal handler function for Ctrl+C
def sigint_handler(signal, frame):
    print("Stopping TTS...")
    # Stop or cleanup threads here
    # You can set some flag to gracefully exit the threads
    # Or call some cleanup function on each thread
    process.kill()
    exit(0)

# Register the signal handler
signal.signal(signal.SIGINT, sigint_handler)

def get_virtualenv_python_executable():
    # Get the path to the virtual environment
    venv_path = os.environ.get('TTS_VIRTUAL_ENV')
    if not venv_path:
        os.environ['TTS_VIRTUAL_ENV'] = str(Path(str(BASE_DIR) + "../../../tts/.venv").resolve())
        venv_path = os.environ.get('TTS_VIRTUAL_ENV')

    # Construct the path to the Python executable within the virtual environment
    if sys.platform.startswith('linux') or sys.platform.startswith('darwin'):
        return os.path.join(venv_path, 'bin', 'python')
    elif sys.platform.startswith('win'):
        return os.path.join(venv_path, 'Scripts', 'python.exe')
    else:
        raise NotImplementedError("Unsupported operating system")

# Event to signal whether the thread is currently running
thread_running_event = Event()
# Global lock
process_lock = Lock()
# Start the long-running script as a separate process
pythonExe = get_virtualenv_python_executable()
ttsProcess = Path(str(BASE_DIR) + "../../../tts/tts.py").resolve()
process = None
try:
    print("Attempt to start TTS process")
    process = subprocess.Popen([pythonExe, ttsProcess], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False)
    print("TTS process started!")
except:
    print(f"No TTS implementation found in {ttsProcess}")

already_processing = []
lines = []
def watch_output():
    global lines
    global process
    
    if not process:
        return
    
    for index, line in enumerate(iter(process.stdout.readline, b'')):
        line = line.decode('utf-8').strip()
        
        if index % 20 == 0:
            # Clear lines when a given file is read to avoid out of memory
            lines = [item for item in lines if item is not None and "@@clear" not in item]
        
        lines.append(line)
        
        print(lines)
        
        # Safeguard clear all lines if too much addup
        if len(lines) > 100:
            lines = []     
watch_output_thread = Thread(target=watch_output, args=(), daemon=False)
# Start the process
watch_output_thread.start()

def watch_process_stderr():
    global process
    # Continuously read from the stdout stream
    # Read stderr in a loop
    for line in iter(process.stderr.readline, b''):
        print("stderr:", line.decode(), end="")
watch_stderr_thread = Thread(target=watch_process_stderr, args=(), daemon=False)
# Start the process
watch_stderr_thread.start()

def tts_process(lock, queue, text, out_path):
    global process
    global lines
    global already_processing
    
    if not process:
        queue.put(out_path)
        return

    if text not in already_processing:
        # Pass data to the long-running script
        data_to_send = text + "@@" + out_path
        process.stdin.write(data_to_send.encode('utf-8') + b'\n')
        process.stdin.flush()
        
        already_processing.append(text)
    
    # Define the duration in minutes
    KILL_AFTER_DURATION_MINUTES = 1 * 60

    # Get the start time
    start_time = time.time()
    
    waiting = True
    while waiting:
        waiting = out_path not in lines
        # Check for text that is marked to be cleared
        if waiting == True:
            # Stop the loop if already processed text
            waiting = f"{out_path}@@clear" not in lines

        if waiting == False:
            if out_path in lines:
                out_index = lines.index(out_path)
                lines[out_index] = f"{out_path}@@clear"
        
        errored = text in lines
        # Check if the time limit has been exceeded
        if time.time() - start_time > KILL_AFTER_DURATION_MINUTES:
            # "Time limit reached. Exiting the loop."
            # Clear what you can and break
            errored = True
        
        if errored:
            out_path = ""
            
            # Mark lines to be cleared
            try:
                text_index = lines.index(text)
                lines[text_index] = None
            except:
                pass
            try:
                error_index = lines.index("error")
                lines[error_index] = None
            except:
                pass
            break
    
    try:
        done_index = lines.index("done")
        lines[done_index] = None
    except:
        pass
    
    # Clear text from already_processing to avoid out of memory
    # if the result is ready, error or not
    if text in already_processing:
        already_processing.remove(text)
    
    queue.put(out_path)

class TTSViewSet(viewsets.ModelViewSet):
    """
	TTS endpoint, accpets text and returns audio binary
	"""
    def create(self, request):
        body = request.data
        
        text: str = body["text"]
        bookFileName: str = body["bookFileName"]

        if len(text) < 1:
            return Response(status=status.HTTP_400_BAD_REQUEST)
        
        # Clean text
        text = text.replace("\n", "")
        
        mp3_path = voiceCacheDirPath(bookFileName, text) + ".mp3"
        
        if os.path.exists(mp3_path) is True:
            soundBinary = open(mp3_path, "rb")
            return FileResponse(soundBinary, content_type="audio/mpeg")
        
        out_path = voiceCacheDirPath(bookFileName, text) + ".wav"
        voice_path = tts(text, out_path)
        
        # TODO:
        # For some reason I wasn't able to start audio using JS MediaSource with wav format
        # it works with MP3. If I load the wav file directly in UI like regular audio (nothing dynamic) it works...
        # Maybe I have to check with what codec TTS generate the wav files and use it.
        sound = AudioSegment.from_wav(voice_path)
        new_voice_path = voice_path.replace(".wav", ".mp3")
        sound.export(new_voice_path, format="mp3")
        
        soundBinary = open(new_voice_path, "rb")
        return FileResponse(soundBinary, content_type="audio/mpeg")

def tts(text: str, out_path: str) -> str:
    global thread_running_event
    global process_lock

    # # Check if the thread is already running
    # with process_lock:
    #     if thread_running_event.is_set():
    #         # If the thread is running, block until it finishes
    #         thread_running_event.wait()
    
    # Create a Queue instance to share data between processes
    queue = multiprocessing.Queue()

    # Create a new Process targeting the child_process function with the queue as argument
    thread = Thread(target=tts_process, args=(process_lock, queue, text, out_path))

    # Start the process
    thread.start()

    # Wait for the process to finish
    thread.join()
    
    # Retrieve the string value from the queue
    voice_path = queue.get()
    
    return voice_path

def voiceCacheDirPath(bookFileName, text) -> str:
    cacheDir = str(BASE_DIR) + "/" + "voice_cache"
    
    if os.path.exists(cacheDir) is False:
        os.mkdir(cacheDir)
    
    voiceCachePath = cacheDir + "/" + bookFileName
    
    if os.path.exists(voiceCachePath) is False:
        os.mkdir(voiceCachePath)
    
    file_name=base64.b64encode(text[0:30].encode('utf-8'))
    return str(Path(str(BASE_DIR) + "/" + "voice_cache" + "/" + bookFileName + "/"  + file_name.decode("utf-8")))
