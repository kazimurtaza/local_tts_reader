let audioElement = null;
let isPlaying = false;

function initAudio() {
  if (!audioElement) {
    audioElement = document.createElement('audio');
    audioElement.id = 'audioElement';
    document.body.appendChild(audioElement);
  }
}

// Process audio data received from background script
function processAudioData(audioData, mimeType, isRecording) {
  try {
    initAudio();

    const blob = new Blob([new Uint8Array(audioData)], { type: mimeType });
    const audioUrl = URL.createObjectURL(blob);

    if (isRecording) {
      chrome.runtime.sendMessage({
        type: 'recordingComplete',
        audioUrl: audioUrl
      });
    }

    playAudioUrl(audioUrl);
    chrome.runtime.sendMessage({ type: 'audioReady' });
  } catch (error) {
    console.error('Error processing audio data:', error);
    chrome.runtime.sendMessage({
      type: 'streamError',
      error: error.message
    });
  }
}

// Play audio from URL
function playAudioUrl(audioUrl) {
  try {
    audioElement.src = audioUrl;

    audioElement.onplay = () => {
      isPlaying = true;
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'playing' });
    };

    audioElement.onpause = () => {
      isPlaying = false;
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'paused' });
    };

    audioElement.onended = () => {
      isPlaying = false;
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'stopped' });
      chrome.runtime.sendMessage({ type: 'streamComplete' });
    };

    audioElement.ontimeupdate = () => {
      chrome.runtime.sendMessage({
        type: 'timeUpdate',
        timeInfo: {
          currentTime: audioElement.currentTime,
          duration: audioElement.duration
        }
      });
    };

    audioElement.play().catch(err => {
      console.error('Play error:', err);
      chrome.runtime.sendMessage({
        type: 'streamError',
        error: err.message
      });
    });
  } catch (error) {
    console.error('Error playing audio URL:', error);
    chrome.runtime.sendMessage({
      type: 'streamError',
      error: error.message
    });
  }
}

// Get current player state
function getPlayerState() {
  if (!audioElement) return 'stopped';
  if (audioElement.paused) {
    return audioElement.currentTime > 0 && audioElement.currentTime < audioElement.duration ? 'paused' : 'stopped';
  }
  return 'playing';
}

// Get current time and duration
function getTimeInfo() {
  if (!audioElement) return null;
  return {
    currentTime: audioElement.currentTime,
    duration: audioElement.duration
  };
}

// Seek to a specific time
function seekTo(time) {
  if (!audioElement) return false;
  try {
    audioElement.currentTime = time;
    return true;
  } catch (error) {
    console.error('Error seeking:', error);
    return false;
  }
}

// Handle messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'processAudioData':
      if (message.audioData) {
        processAudioData(message.audioData, message.mimeType, message.isRecording);
      }
      break;

    case 'play':
      if (audioElement) {
        audioElement.play();
      }
      break;

    case 'pause':
      if (audioElement) {
        audioElement.pause();
      }
      break;

    case 'stop':
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
        chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'stopped' });
      }
      break;

    case 'seek':
      const success = seekTo(message.time);
      sendResponse({ success });
      return true;

    case 'getState':
      sendResponse({ state: getPlayerState() });
      return true;

    case 'getTimeInfo':
      sendResponse({ timeInfo: getTimeInfo() });
      return true;
  }
});

// Initialize when the document loads
document.addEventListener('DOMContentLoaded', () => {
  initAudio();
});
