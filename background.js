let offscreenDocument = null;
let isRecording = false;
let currentPlayerState = 'stopped';
let currentAbortController = null;
let chunkQueue = [];
let currentChunkIndex = 0;
let isChunkedMode = false;
let lastSettings = null;

// Create or get the offscreen document, re-creating if Chrome auto-closed it
async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    offscreenDocument = existingContexts[0];
    return;
  }

  // Chrome auto-closes offscreen docs after 30s inactivity — recreate
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Playing TTS audio in the background'
    });
  } catch (e) {
    if (e.message?.includes('Only a single offscreen')) {
      await chrome.offscreen.closeDocument();
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Playing TTS audio in the background'
      });
    } else {
      throw e;
    }
  }
}

// Send message to offscreen, retrying if it was killed
async function sendToOffscreen(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (e) {
    if (e.message?.includes('Receiving end does not exist') || e.message?.includes('Could not establish connection')) {
      await setupOffscreenDocument();
      await chrome.runtime.sendMessage(message);
    } else {
      throw e;
    }
  }
}

// Set up context menu items
function setupContextMenu() {
  chrome.contextMenus.create({
    id: "readAloud",
    title: "Read Aloud",
    contexts: ["selection", "page"]
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "readAloud") {
    let text = info.selectionText || "";
    
    if (!text) {
      // If no text is selected, get the page content
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
          return document.body.innerText;
        }
      }).then(results => {
        if (results && results[0] && results[0].result) {
          processAndReadText(results[0].result, tab.id);
        }
      });
    } else {
      // Use the selected text
      processAndReadText(text, tab.id);
    }
  }
});

// Process and read text with default settings
async function processAndReadText(text, tabId) {
  try {
    // Get default settings
    const settings = await chrome.storage.local.get({
      serverUrl: 'http://10.0.0.172:8880/v1/audio/speech',
      voice: 'af_bella',
      speed: 1.0,
      recordAudio: false,
      preprocessText: true,
      apiKey: '',
      model: 'tts-1',
      responseFormat: 'mp3'
    });
    
    // Process text if enabled
    if (settings.preprocessText && tabId) {
      try {
        // Inject the text processor script if needed
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['textProcessor.js']
        });
        
        // Process the text
        const result = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (textToProcess) => {
            return window.TextProcessor.process(textToProcess);
          },
          args: [text]
        });
        
        if (result && result[0] && result[0].result) {
          text = result[0].result;
        }
      } catch (error) {
        console.error('Error processing text:', error);
        // Fall back to using the original text
      }
    }
    
    // Set state to loading
    currentPlayerState = 'loading';
    chrome.runtime.sendMessage({ 
      type: 'playerStateUpdate', 
      state: 'loading' 
    });
    
    // Start streaming audio
    startStreamingAudio(text, settings);
  } catch (error) {
    console.error('Error in processAndReadText:', error);
    chrome.runtime.sendMessage({ 
      type: 'streamError', 
      error: error.message 
    });
  }
}

// Handle messages from popup or offscreen document
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'setupOffscreen':
      setupOffscreenDocument().then(() => sendResponse({ success: true }));
      return true;
      
    case 'startStreaming':
      isRecording = message.record;
      // Set state to loading before starting the audio stream
      currentPlayerState = 'loading';
      chrome.runtime.sendMessage({ 
        type: 'playerStateUpdate', 
        state: 'loading' 
      });
      startStreamingAudio(message.text, message.settings);
      sendResponse({ success: true });
      return true;
      
    case 'controlAudio':
      sendToOffscreen({ type: message.action, data: message.data });
      return true;
      
    case 'stateUpdate':
      currentPlayerState = message.state;
      chrome.runtime.sendMessage({ 
        type: 'playerStateUpdate', 
        state: message.state 
      });
      return true;
      
    case 'audioReady':
      // Audio is ready but not yet playing
      if (currentPlayerState === 'loading') {
        currentPlayerState = 'ready';
        chrome.runtime.sendMessage({ 
          type: 'playerStateUpdate', 
          state: 'ready' 
        });
      }
      return true;
      
    case 'getPlayerState':
      sendResponse({ state: currentPlayerState });
      return true;
      
    case 'seek':
      (async () => {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'seek', time: message.time });
          sendResponse(resp);
        } catch (e) {
          if (e.message?.includes('Receiving end does not exist')) {
            await setupOffscreenDocument();
            const resp = await chrome.runtime.sendMessage({ type: 'seek', time: message.time });
            sendResponse(resp);
          } else {
            sendResponse({ success: false });
          }
        }
      })();
      return true;

    case 'getTimeInfo':
      (async () => {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'getTimeInfo' });
          sendResponse(resp);
        } catch (e) {
          if (e.message?.includes('Receiving end does not exist')) {
            sendResponse({ timeInfo: null });
          } else {
            sendResponse({ timeInfo: null });
          }
        }
      })();
      return true;
      
    case 'timeUpdate':
      // Forward time updates to the popup
      chrome.runtime.sendMessage(message);
      return true;

    case 'abortStreaming':
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
      isChunkedMode = false;
      chunkQueue = [];
      sendResponse({ success: true });
      return true;

    case 'streamComplete':
      if (isChunkedMode && currentChunkIndex < chunkQueue.length - 1) {
        currentChunkIndex++;
        if (lastSettings) {
          fetchAndSendChunk(chunkQueue[currentChunkIndex], lastSettings);
        }
      } else {
        isChunkedMode = false;
        chunkQueue = [];
      }
      return true;

    case 'keepalive':
      return true;

    case 'fetchVoices':
      (async () => {
        try {
          const settings = await chrome.storage.local.get({ serverUrl: 'http://10.0.0.172:8880/v1/audio/speech', apiKey: '' });
          const baseUrl = settings.serverUrl.replace(/\/v1\/audio\/speech$/, '');
          const headers = {};
          if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

          const response = await fetch(`${baseUrl}/v1/audio/voices`, { headers });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          sendResponse({ voices: data.data || data });
        } catch (error) {
          sendResponse({ voices: null, error: error.message });
        }
      })();
      return true;
  }
});

// Split text into chunks at sentence boundaries
function chunkText(text, maxChunkSize = 500) {
  if (text.length <= maxChunkSize) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkSize) {
      chunks.push(remaining);
      break;
    }

    let splitPoint = remaining.lastIndexOf('. ', maxChunkSize);
    if (splitPoint < maxChunkSize * 0.3) splitPoint = remaining.lastIndexOf('! ', maxChunkSize);
    if (splitPoint < maxChunkSize * 0.3) splitPoint = remaining.lastIndexOf('? ', maxChunkSize);
    if (splitPoint < maxChunkSize * 0.3) splitPoint = remaining.lastIndexOf(' ', maxChunkSize);
    if (splitPoint < 1) splitPoint = maxChunkSize;

    chunks.push(remaining.substring(0, splitPoint + 1).trim());
    remaining = remaining.substring(splitPoint + 1).trim();
  }

  return chunks;
}

// Fetch audio for a single text chunk
async function fetchAndSendChunk(text, settings) {
  try {
    currentAbortController = new AbortController();

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg, audio/wav, audio/*'
    };
    if (settings.apiKey) {
      headers['Authorization'] = `Bearer ${settings.apiKey}`;
    }

    const response = await fetch(settings.serverUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: settings.model || 'tts-1',
        voice: settings.voice,
        input: text,
        speed: parseFloat(settings.speed),
        response_format: settings.responseFormat || 'mp3',
        stream: false
      }),
      signal: currentAbortController.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const mimeType = 'audio/mpeg';

    currentAbortController = null;

    const isLastChunk = !isChunkedMode || currentChunkIndex >= chunkQueue.length - 1;

    // Ensure offscreen document is alive before sending (Chrome kills it after 30s)
    await setupOffscreenDocument();

    await sendToOffscreen({
      type: 'processAudioData',
      audioData: Array.from(uint8Array),
      mimeType: mimeType,
      isRecording: isRecording && isLastChunk
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      currentPlayerState = 'stopped';
      chrome.runtime.sendMessage({ type: 'playerStateUpdate', state: 'stopped' });
      return;
    }
    isChunkedMode = false;
    chunkQueue = [];
    console.error('Error streaming audio:', error);
    chrome.runtime.sendMessage({
      type: 'streamError',
      error: error.message
    });
    currentPlayerState = 'stopped';
    chrome.runtime.sendMessage({
      type: 'playerStateUpdate',
      state: 'stopped'
    });
  }
}

// Start streaming audio from the TTS server
async function startStreamingAudio(text, settings) {
  lastSettings = settings;
  await setupOffscreenDocument();

  const chunks = chunkText(text);

  if (chunks.length <= 1) {
    isChunkedMode = false;
    await fetchAndSendChunk(chunks[0], settings);
  } else {
    isChunkedMode = true;
    chunkQueue = chunks;
    currentChunkIndex = 0;
    await fetchAndSendChunk(chunkQueue[0], settings);
  }
}

// Initialize context menu when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu();
});

// Keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'read-selection') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    let text = '';
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => window.getSelection().toString().trim() || document.body.innerText
      });
      text = results[0].result;
    } catch (e) {
      console.error('Cannot access page:', e);
      return;
    }

    if (text) processAndReadText(text, tab.id);
  }

  if (command === 'stop-playback') {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    sendToOffscreen({ type: 'stop' });
    currentPlayerState = 'stopped';
    chrome.runtime.sendMessage({ type: 'playerStateUpdate', state: 'stopped' });
  }
});