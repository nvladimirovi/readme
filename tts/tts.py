import sys
from TTS.api import TTS
model = TTS("tts_models/multilingual/multi-dataset/xtts_v2", gpu=True)

"""
!!! TODO: YOU CAN USE MORE THREADS TO TTS MORE THEN ONE TEXT AT A TIME!!!
"""
while True:
    # Read data from standard input
    [text, output_path] = sys.stdin.readline().strip().split("@@")
    try:
        # generate speech by cloning a voice using default settings
        model.tts_to_file(text=text,
                file_path=output_path,
                speaker="Nova Hogarth",
                language="en",
                split_sentences=True
                )
        print(output_path)
        print("done")
        # Flush the output to ensure it's immediately sent
        sys.stdout.flush()
    except Exception as e:
        print(text)
        print("error")