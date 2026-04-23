const DEFAULT_SETTINGS = {
    serverUrl: 'http://10.0.0.172:8880/v1/audio/speech',
    voice: 'af_bella',
    speed: 1.0,
    recordAudio: false,
    preprocessText: true
  };
  
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DEFAULT_SETTINGS };
  } else {
    self.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  }