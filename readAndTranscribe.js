const speech = require('@google-cloud/speech');
const fs = require('fs');

let fd = -1;

function basename(path) {
  return path.replace(/.*\/|\.*$/g, '');
}

function formatTime(time) {
  let hour = Math.floor(time / 3600);
  let min = Math.floor(time / 60);
  let sec = Math.floor(time - (min * 60));

  hour < 10 ? hour = `0${hour}` : hour.toString();
  min < 10 ? min = `0${min}` : min = min.toString();
  sec < 10 ? sec = `0${sec}` : sec = sec.toString();

  return `${hour}:${min}:${sec}`;
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
  -c, --chunkduration        The duration in seconds of audio buffer to submit
                             to Google for transcription. Defaults to 10
                             seconds, and must not exceed 60 seconds.
  -d, --debug                debug mode
  -h, --help                 This help message

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

console.log('process.stdin :', process.stdin);

if (argv._.length !== 0) {
  fd = fs.openSync(fileName, 'r');
} else {
  fd = process.stdin.fd;
}

const header = Buffer.alloc(44);

const languageCode = argv.l || argv.lang || 'en-US';
console.log('Transcription language : ', languageCode);

const debug = argv.d || argv.debug || false;
console.log('debug : ', debug);

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
if (header.readUIntLE(22, 2) !== 1 && header.readUIntLE(22, 2) !== 2) {
  console.log('Error: One channel (mono) or two channels (stereo) accepted');
  fs.closeSync(fd);
  printHelpAndExit();
}

const sampleRateHertz = header.readUIntLE(24, 4);
const bitsPerSample = header.readUIntLE(34, 2);
const bitRate = sampleRateHertz * bitsPerSample;

console.log('Sample rate :', sampleRateHertz);
console.log('Bits per sample :', bitsPerSample);
console.log('Bit rate :', bitRate, 'bits/s');

if (bitsPerSample !== 16) {
  console.log('Error: Invalid sample size', bitsPerSample);
  closeAudioFileAndExit();
}

const encoding = `LINEAR${bitsPerSample}`;
console.log('Encoding : ', encoding);

const duration = argv.c || argv.chunkduration || 10;
if (duration < 10 || duration > 60) {
  console.log('Error: Invalid audio chunk duration');
  fs.closeSync(fd);
  printHelpAndExit();
}

const chunkSize = duration * channels * sampleRateHertz * (bitsPerSample / 8);
const audioBuffer = Buffer.alloc(chunkSize);

let audioBufferChannelsArray = [];
for (let i = 0; i < channels; i += 1) {
  audioBufferChannelsArray[i] = Buffer.alloc(chunkSize / channels);
}

let totalAudioBytesRead = 0;
let relativeAudioBytesRead = 0;

console.log('chunk size :', chunkSize, 'bits, chunk duration :', duration, 'seconds');

// Creates a client
const client = new speech.SpeechClient();

const transcriptionForChannels = [];
let intervalCounter = 0;

const interval = setInterval(() => {
  let audioBytesRead = 0;

  if (relativeAudioBytesRead > 0 && relativeAudioBytesRead < chunkSize) {
    // Need more data
    debug && console.log('Buffer is not full, still filling it');
    audioBytesRead = fs.readSync(
      fd,
      audioBuffer,
      relativeAudioBytesRead,
      chunkSize - relativeAudioBytesRead,
    );
  } else if (relativeAudioBytesRead >= chunkSize) {
    debug && console.log('Buffer is full, starting with new data');
    relativeAudioBytesRead = 0;
    audioBytesRead = fs.readSync(fd, audioBuffer, 0, chunkSize);
  } else if (relativeAudioBytesRead === 0) {
    debug && console.log('New buffer');
    audioBytesRead = fs.readSync(fd, audioBuffer, 0, chunkSize);
  }

  relativeAudioBytesRead += audioBytesRead;

  if (audioBytesRead === 0) {
    debug && console.log('End of file readched, exiting soon...');
    clearInterval(interval);
    for (let i = 0; i < transcriptionForChannels.length; i += 1) {
      for (let j = 0; j < channels; j += 1) {
        console.log(`[${transcriptionForChannels[i].timestamp} CHANNEL ${j}] : ${transcriptionForChannels[i].channels[j]}`);
      }
    }
    return;
  }

  totalAudioBytesRead += audioBytesRead;
  const timestampSec = totalAudioBytesRead / (2 * sampleRateHertz * channels);
  const timestamp = formatTime(timestampSec);

  // Copy audio buffers for every channel
  for (let i = 0; i < chunkSize; i += channels * (bitsPerSample / 8)) {
    for (let j = 0; j < channels; j += 1) {
      audioBuffer.copy(audioBufferChannelsArray[j], i / channels, i + (j * channels), i + (j * channels) + (bitsPerSample / 8));
    }
  }

  debug && console.log('audioBuffer : ', audioBuffer);
  for (let i = 0; i < channels; i += 1) {
    debug && console.log(`audioBufferChannels[${i}] : `, audioBufferChannelsArray[i]);
  }

  debug && console.log('Cursor is at ', timestamp, 'sec');
  debug && console.log('Read', audioBytesRead / (channels * sampleRateHertz), 'seconds length of data');

  transcriptionForChannels[intervalCounter] = {};
  transcriptionForChannels[intervalCounter].timestamp = timestamp;
  transcriptionForChannels[intervalCounter].channels = new Array(channels);

  const requestForChannelArray = [];
  for (let i = 0; i < channels; i += 1) {
    requestForChannelArray[i] = {
      audio: {
        content: audioBufferChannelsArray[i].toString('base64'),
      },
      config: {
        encoding,
        sampleRateHertz,
        languageCode,
      }
    }
  }

  ((index) => {
    Promise
      .all(requestForChannelArray.map((request) => { return client.recognize(request); }))
      .then((arrayData) => {
        for (let i = 0; i < channels; i += 1) {
          const response = arrayData[i][0];
          const transcription = response.results
            .map(result => result.alternatives[0].transcript)
            .join('\n');
          transcriptionForChannels[index].channels[i] = transcription;
          console.log(`[${transcriptionForChannels[index].timestamp} CHANNEL ${i}] : ${transcriptionForChannels[index].channels[i]}`);
        }
      })
      .catch((err) => {
        console.error('ERROR:', err);
      });
  })(intervalCounter);

  intervalCounter += 1;
}, 2000);

