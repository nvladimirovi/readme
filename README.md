# README: Text-to-Speech Audiobook Generator
## Overview
README is a project designed to facilitate the creation of audiobooks using state-of-the-art Text-to-Speech (TTS) models. With README, users can convert written text into high-quality audio narrations, allowing for the easy production of audiobooks across various genres and languages.

![readme_overview](https://github.com/nvladimirovi/readme/assets/29869465/9da91956-8b61-40e9-a870-24a95ec421dd)

## Features
- Text-to-Speech Conversion: README utilizes advanced TTS models to convert written text into natural-sounding audio.
- Customization Options: Users can customize various aspects of the audio output, including voice style, speed, and tone.
- Multi-language Support: README supports multiple languages, enabling the creation of audiobooks in different linguistic contexts.
- Quality Assurance: README incorporates quality assurance measures to ensure the clarity and coherence of the audio output.

## Demo
https://github.com/nvladimirovi/readme/assets/29869465/65dededc-8fbd-48ef-9f44-758e2c615b14

## Download
- Download `Windows EXE 64bit CUDA 12.1` and unzip it

### How to run it
1. If you run README for 1st time run `./tts.exe` to download the TTS model, once the model is downloaded kill the process
2. Run `./manage.exe runserver --noreload` to start README
3. Open your browser

## Getting Started
Requirements:
- Python 3.10.11
- NodeJS 14.20.1

### Install Dependencies
```bash
python -m venv ./.venv
# Activate virtual env
# For windows
./.venv/Scripts/Activate.ps1
# For Unix
source ./.venv/bin/activate

pip install -r requirements.txt

cd ./frontend
npm i
cd ./frontend/projects/ui
npm i
```

### Build UI
```bash
cd ./frontend/projects/ui
npm run build
```

### Setup TTS Model
README webserver will start your TTS model as a seprate process.
```bash
cd ./tts/
python -m venv ./.venv
# Activate virtual env
# For windows
./.venv/Scripts/Activate.ps1
# For Unix
source ./.venv/bin/activate

pip install -r requirements.txt

# If the above fail
# Install pytorch
# See https://pytorch.org/get-started/locally/
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# And then run again
pip install -r requirements.txt

# (Optional)
# If you want to create your own implementation
cp tts_template.py tts.py
# Install your TTS model dependencies
# Place your TTS model implementation in inference mode in tts.py
```
By default README searches for virtual env with name `.venv`. If you want to change the default path set TTS_VIRTUAL_ENV env variable with the absolute path to your virtual env folder.
```bash
# (Optional) Change default TTS virtual env
export set TTS_VIRTUAL_ENV=<your_absolute_path>
```

### Install FFMPEG
Check if you have ffmpeg installed by running:
```bash
ffmpeg -version
```

#### Install For Windows
To install FFMPEG see the instructions in [./setup_ffmpeg.pdf](setup_ffmpeg.pdf)

#### Install For Mac
```bash
brew install ffmpeg
```

#### Install For Linux
```bash
sudo apt install ffmpeg
```

### Start README
```bash
python ./backend/server/manage.py runserver
# Open http://127.0.0.1:8000/
```

### Build Executable
Make sure PyInstaller is installed in the `root` of the project and in the `tts` folder.

1. Open `backend\server\api\views.py` and replace `tts.py` process with `tts.exe`.
2. Rename `manage.spec.pyinstaller` and `tts.spec.pyinstaller` to `manage.spec` and `tts.spec`.
3. To build the README server run:
```bash
# Activate virtual env
# For windows
./.venv/Scripts/Activate.ps1
# For Unix
source ./.venv/bin/activate

pyinstaller ./manage.spec
```
4. To build the TTS model
```bash
# Activate virtual env
# For windows
./tts/.venv/Scripts/Activate.ps1
# For Unix
source ./tts/.venv/bin/activate

pyinstaller ./tts.spec
```
5. Done!

The end result should be dist folder in the root with `manage.exe` and `tts.exe`.

## License
README is licensed under the MIT License, allowing for flexibility in use and distribution.

## Acknowledgements
README would like to acknowledge the contributions of the open-source community and the developers behind the TTS models and libraries used in this project. Their dedication and innovation make projects like README possible.
