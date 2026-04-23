/**
 * Text processor for TTS
 * - Removes markdown formatting
 * - Cleans up URLs
 * - Removes special characters that don't read well
 */
class TextProcessor {
  /**
   * Process text for TTS
   * @param {string} text - The text to process
   * @returns {string} - The processed text
   */
  static process(text) {
    if (!text) return '';
    
    let processedText = text;
    
    // Remove markdown headers
    processedText = processedText.replace(/^#{1,6}\s+(.+)$/gm, '$1');
    
    // Remove markdown bold/italic
    processedText = processedText.replace(/(\*\*|__)(.*?)\1/g, '$2');
    processedText = processedText.replace(/(\*|_)(.*?)\1/g, '$2');
    
    // Remove markdown code blocks
    processedText = processedText.replace(/```[\s\S]*?```/g, 'code block omitted');
    processedText = processedText.replace(/`([^`]+)`/g, '$1');
    
    // Remove markdown links but keep the text
    processedText = processedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    
    // Process URLs
    processedText = this.processUrls(processedText);
    
    // Remove special characters that don't read well
    processedText = processedText.replace(/[|*~`]/g, ' ');
    
    // Remove excessive whitespace
    processedText = processedText.replace(/\s+/g, ' ').trim();
    
    // Remove markdown list markers
    processedText = processedText.replace(/^[\s-]*[-*+]\s+/gm, '');
    processedText = processedText.replace(/^\s*\d+\.\s+/gm, '');
    
    // Remove HTML tags
    processedText = processedText.replace(/<[^>]*>/g, '');
    
    // Replace common symbols with words
    processedText = processedText.replace(/&/g, ' and ');
    processedText = processedText.replace(/\$(\d[\d,]*)/g, '$1 dollars');
    processedText = processedText.replace(/\$(?!\d)/g, ' dollar ');
    processedText = processedText.replace(/%/g, ' percent ');
    processedText = processedText.replace(/\^/g, ' ');
    
    // Replace multiple dots with a single period
    processedText = processedText.replace(/\.{2,}/g, '.');
    
    return processedText;
  }
  
  /**
   * Process URLs in text
   * @param {string} text - The text containing URLs
   * @returns {string} - Text with processed URLs
   */
  static processUrls(text) {
    return text.replace(/(https?:\/\/[^\s]+)/g, '');
  }
}

// Make available globally
window.TextProcessor = TextProcessor;
