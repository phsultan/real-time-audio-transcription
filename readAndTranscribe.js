const speech = require('@google-cloud/speech');
const fs = require('fs');

let fd = -1;

function formatTime(time) {
  let hour = Math.floor(time / 3600);
  let min = Math.floor(time / 60);
  let sec = Math.floor(time - (min * 60));

  hour < 10 ? hour = `0${hour}` : hour.toString();
  min < 10 ? min = `0${min}` : min = min.toString();
  sec < 10 ? sec = `0${sec}` : sec = sec.toString();

  return `${hour}:${min}:${sec}`;
}

function getTranscription(startSec, audioBytes, googleConfig, googleSpeechClient) {
  const audio = {
    content: audioBytes,
  };

  const request = {
    audio,
    config: googleConfig,
  };

  ((start) => {
    googleSpeechClient
      .recognize(request)
      .then((data) => {
        const response = data[0];
        const transcription = response.results
          .map(result => result.alternatives[0].transcript)
          .join('\n');
        console.log(`[${formatTime(start)}] : ${transcription}`);
      })
      .catch((err) => {
        console.error('ERROR:', err);
      });
  })(startSec);
}

function computeEnergy(buffer, index, length) {
  let energy = 0;
  for (let i = 0; i < length; i += 2) {
    const val = buffer.readInt16LE(index + i);
    energy += Math.abs(val);
  }

  return Math.round(energy / length);
}

function basename(path) {
  return path.replace(/.*\/|\.*$/g, '');
}

function closeAudioFileAndExit() {
  fs.closeSync(fd);
  process.exit();
}

function printHelpAndExit() {
  console.log(`
Usage: node ${basename(process.argv[1])} [options] [filename]

  finename                   Audio file to transcribe, a WAV container. If not
                             present, audio is read from standard input.

Options:
  -l, --lang                 Transcription language code, e.g. : en-US, fr-FR.
                             Defaults to en-US.

  -s, --silence              Frames with energy under this value will be considered
                             to be silent. Defaults to 100 (purely arbitrary !).

  -e, --eof                  The maximum number of tries to consider that the
                             end of file (EOF) has been reached. Useful if you run
                             this program to transcribe a file that is being
                             continuously fed with new audio data. Defaults to 4.

  -m, --minaudio             The minimum acceptable duration of speech to trigger
                             a recognition request. More audio data will be collected
                             if we're under this value before issuing a recognition
                             request. Defaults to 2 seconds.

  -M, --maxaudio             The maximum acceptable duration of speech to trigger
                             a recognition request. If we don't detect any silence
                             and the audio buffer is about to exceed this value,
                             then we force a recognition request to Google.
                             Defaults to 10 seconds.

  -d, --debug                Run in debug mode.

  -h, --help                 Show this help message.

Requirements: You need a valid service account for a Google Cloud Platform
project to run this program.

If you need to get service account, you need to :
  - Create or select a project
  - Enable the Cloud Speech API for that project
  - Create a service account
  - Download a private key as JSON

And then et the environment variable GOOGLE_APPLICATION_CREDENTIALS to the
file path of the JSON file that contains your service account key.
More info here : https://cloud.google.com/nodejs/
`);
  process.exit();
}

const argv = require('minimist')(process.argv.slice(2));

if (argv.h || argv.help) {
  printHelpAndExit();
}

if (argv._.length === 0) {
  console.log('Reading from STDIN');
}

if (argv._.length !== 1 && argv._.length !== 0) {
  console.log('Error: Invalid arguments');
  printHelpAndExit();
}

if (argv._.length !== 0 && fs.existsSync(argv._[0]) === false) {
  console.log(`Error: file ${argv._[0]} does not exist`);
  printHelpAndExit();
}

if (typeof process.env.GOOGLE_APPLICATION_CREDENTIALS === 'undefined') {
  console.log('Error: please set the GOOGLE_APPLICATION_CREDENTIALS environment variable');
  printHelpAndExit();
}

if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
  console.log(`Error: File at ${process.env.GOOGLE_APPLICATION_CREDENTIALS} does not exist`);
  printHelpAndExit();
}

// The name of the audio file to transcribe
const fileName = argv._[0];

if (argv._.length !== 0) {
  fd = fs.openSync(fileName, 'r');
} else {
  fd = fs.openSync('/dev/stdin', 'rs');
}

const header = Buffer.alloc(44);

const languageCode = argv.l || argv.lang || 'en-US';
console.log('Transcription language : ', languageCode);

const debug = argv.d || argv.debug || false;
console.log('debug : ', debug);

let silenceThreshold = argv.s || argv.silence || 100;
if (Number.isNaN(silenceThreshold)) {
  silenceThreshold = 100;
}

const eofRetries = argv.e || argv.eof || 4;

let minAudioDurationToSend = argv.m || argv.minaudio || 2;
if (Number.isNaN(minAudioDurationToSend)) {
  minAudioDurationToSend = 2;
}

let maxAudioDurationToSend = argv.M || argv.maxaudio || 10;
if (Number.isNaN(maxAudioDurationToSend)) {
  maxAudioDurationToSend = 10;
}

if (fs.readSync(fd, header, 0, 44) !== 44) {
  console.log('Error: Cannot read file.');
  closeAudioFileAndExit();
}

if (header.toString('ascii', 0, 4) !== 'RIFF') {
  console.log('Error: Invalid WAV format (RIFF missing)');
  fs.closeSync(fd);
  printHelpAndExit();
}

if (header.toString('ascii', 8, 12) !== 'WAVE') {
  console.log('Error: Invalid WAV format (WAVE missing)');
  fs.closeSync(fd);
  printHelpAndExit();
}

console.log('PCM :', header.readUIntLE(20, 2));
if (header.readUIntLE(20, 2) !== 1) {
  console.log('Error: Invalid WAV format (accepted format is PCM only)');
  fs.closeSync(fd);
  printHelpAndExit();
}

const channels = header.readUIntLE(22, 2);
console.log('Channels :', channels);
if (header.readUIntLE(22, 2) !== 1) {
  console.log('Error: One channel (mono) accepted');
  fs.closeSync(fd);
  printHelpAndExit();
}

const sampleRateHertz = header.readUIntLE(24, 4);
const bitsPerSample = header.readUIntLE(34, 2);
const bitRate = sampleRateHertz * bitsPerSample;

console.log('Sample rate :', sampleRateHertz);
console.log('Bits per sample :', bitsPerSample);
console.log('Bit rate :', bitRate, 'bits/s');
console.log('Silence threshold :', silenceThreshold);
console.log('EOF retries :', eofRetries);
console.log('Minimum audio buffer length :', minAudioDurationToSend, 'seconds');
console.log('Maximum audio buffer length :', maxAudioDurationToSend, 'seconds');

if (bitsPerSample !== 16) {
  console.log('Error: Invalid sample size', bitsPerSample);
  closeAudioFileAndExit();
}

const encoding = `LINEAR${bitsPerSample}`;
console.log('Encoding : ', encoding);

// Get 200ms of data every 200ms
const duration = 0.2;
const sampleSize = bitsPerSample / 8;
const chunkSize = duration * sampleRateHertz * (bitsPerSample / 8);
const audioBuffer = Buffer.alloc(chunkSize);
const maxAudioBufferToSendSize = maxAudioDurationToSend * sampleRateHertz * (bitsPerSample / 8);
const minAudioBufferToSendSize = minAudioDurationToSend * sampleRateHertz * (bitsPerSample / 8);
const audioBufferToSend =
  Buffer.alloc(maxAudioDurationToSend * sampleRateHertz * (bitsPerSample / 8));

let totalAudioBytesRead = 0;

console.log('chunk size :', chunkSize, 'bytes, chunk duration :', duration, 'seconds');

// Creates a client
const client = new speech.SpeechClient();
const config = {
  encoding,
  sampleRateHertz,
  languageCode,
};

let emptyRead = 0;
let silenceFramesNum = 0;
let audioBufferOffset = 0;
audioBufferToSend.fill(0);

let timerId = setTimeout(function tick() {
  let audioBytesRead = 0;

  audioBytesRead = fs.readSync(fd, audioBuffer, 0, chunkSize);

  if (audioBytesRead < 1) {
    emptyRead += 1;

    if (emptyRead > eofRetries) {
      debug && console.log('Read 0 bytes for too long, clearing timeout and leaving');
      // Last transcription request to send
      getTranscription((totalAudioBytesRead - audioBufferOffset - audioBytesRead) / (sampleSize * sampleRateHertz), audioBufferToSend.toString('base64'), config, client);
      clearTimeout(timerId);
      return;
    }

    debug && console.log('Read 0 bytes, still getting more data if any...');
    timerId = setTimeout(tick, duration * 1000);
    return;
  }

  emptyRead = 0;
  totalAudioBytesRead += audioBytesRead;

  const timestampSec = totalAudioBytesRead / (sampleSize * sampleRateHertz);
  const timestamp = formatTime(timestampSec);
  const startOfSpeechSec =
    (totalAudioBytesRead - audioBufferOffset - audioBytesRead) / (sampleSize * sampleRateHertz);

  const step = Math.round(audioBuffer.length);
  for (let j = 0; j < audioBuffer.length; j += step) {
    const energy = computeEnergy(audioBuffer, j, step);
    if (energy < silenceThreshold) {
      debug && console.log(`[${timestamp}] Energy : ${energy} (SILENCE)`);
      silenceFramesNum += 1;
    } else {
      debug && console.log(`[${timestamp}] Energy : ${energy}`);
      silenceFramesNum = 0;
    }
  }

  debug && console.log('Cursor is at ', timestamp, 'sec');
  debug && console.log('Read', audioBytesRead / (sampleSize * sampleRateHertz), 'seconds length of data');
  debug && console.log('audioBufferOffset :', audioBufferOffset);

  /**
   * Various conditions that trigger transcription to Google :
   * - audio data extends maxAudioBufferToSendSize
   * - audio data extends minAudioBufferToSendSize and got silence
   */
  if (audioBufferOffset + audioBytesRead > maxAudioBufferToSendSize) {
    // Reached end of buffer
    getTranscription(startOfSpeechSec, audioBufferToSend.toString('base64'), config, client);
    audioBufferOffset = 0;
    audioBufferToSend.fill(0);
    debug && console.log('Reached end ob buffer, now resetting!!!!!');
  } else if (silenceFramesNum > 4 &&
    (audioBufferOffset + audioBytesRead) > minAudioBufferToSendSize) {
    // Got silence and enough data in buffer
    let silenceFramesNumInBuffer = 0;
    let framesNum = 0;
    for (let j = 0; j < audioBufferOffset + audioBytesRead; j += step) {
      const energy = computeEnergy(audioBufferToSend, j, step);
      if (energy < silenceThreshold) {
        silenceFramesNumInBuffer += 1;
      }

      framesNum += 1;
    }

    const silencePct = Math.round((silenceFramesNumInBuffer / framesNum) * 100);
    debug && console.log(`Silence : ${Math.round((silenceFramesNumInBuffer / framesNum) * 100)}%`);

    // Ask for transcription if actual speech has been detected
    if (silencePct < 90) {
      getTranscription(startOfSpeechSec, audioBufferToSend.toString('base64'), config, client);
      console.log('End of speech detected, asking for transcription, audioBufferOffset :', audioBufferOffset);
    } else {
      debug && console.log('No speech detected, won\'t ask Google to transcribe');
    }

    audioBufferOffset = 0;
    audioBufferToSend.fill(0);
  }

  audioBuffer.copy(audioBufferToSend, audioBufferOffset);
  debug && console.log('audioBufferToSend : ', audioBufferToSend);
  audioBufferOffset += audioBytesRead;

  timerId = setTimeout(tick, duration * 1000);
}, duration * 1000);
