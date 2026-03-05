import { useState, useEffect } from 'react';

export function useGeminiNano() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const check = async () => {
      try {
        if (typeof window === 'undefined' || !window.ai) {
          setIsAvailable(false);
          return;
        }
        // Check for language model API availability
        if (window.ai.languageModel) {
          const capabilities = await window.ai.languageModel.capabilities();
          setIsAvailable(capabilities?.available === 'readily' || capabilities?.available === 'after-download');
        } else {
          setIsAvailable(false);
        }
      } catch {
        setIsAvailable(false);
      }
    };
    check();
  }, []);

  const generateImage = async (prompt) => {
    if (!isAvailable) return null;
    setIsLoading(true);
    setError(null);
    try {
      // Gemini Nano image generation (Chrome AI API)
      if (window.ai?.imageGeneration) {
        const result = await window.ai.imageGeneration.generate({ prompt });
        return result;
      }
      throw new Error('Image generation not available');
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const describeImage = async (file) => {
    if (!isAvailable) return null;
    setIsLoading(true);
    setError(null);
    try {
      const session = await window.ai.languageModel.create({
        systemPrompt: 'You are an image analysis assistant. Describe what you see in the provided image in detail.',
      });

      // Convert file to base64 for analysis
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      const result = await session.prompt(`Describe this image: [image data: ${base64.substring(0, 100)}...]`);
      session.destroy();
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { isAvailable, generateImage, describeImage, isLoading, error };
}
