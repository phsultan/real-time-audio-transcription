# real-time-audio-transcription
Read wav audio files and get their audio chunks transcribed by Google Speech API in real time.

This program takes an audio file as an input and uses Google Speech API to output a text transcription.

# Requirements
* Node.js
* A Google Speech API enabled project

# Usage
```
Usage: node readAndTranscribe.js [options] filename projectId

  finename                   Audio file to transcribe, a WAV container
  projectId                  Your Google Cloud Platform project ID

Options:
  -l, --lang                 Transcription language code, e.g. : en-US, fr-FR.
                             Defaults to en-US.
  -c, --chunkduration        The duration in seconds of audio buffer to submit
                             to Google for transcription. Defaults to 10
                             seconds, and must not exceed 60 seconds.
  -d, --debug                debug mode
  -h, --help                 This help message
```
