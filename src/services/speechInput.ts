interface SpeechResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}

interface SpeechResultEvent {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
}

interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechConstructor = new () => SpeechRecognizer;

interface SpeechWindow {
  isSecureContext?: boolean;
  SpeechRecognition?: SpeechConstructor;
  webkitSpeechRecognition?: SpeechConstructor;
}

function getSpeechConstructor(): SpeechConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const speechWindow = window as unknown as SpeechWindow;
  if (speechWindow.isSecureContext !== true) return undefined;
  const constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  return typeof constructor === 'function' ? constructor : undefined;
}

export function supportsSpeechInput(): boolean {
  return getSpeechConstructor() !== undefined;
}

export function startSpeechInput(locale: string, callbacks: {
  onTranscript: (text: string) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}): { stop: () => void; abort: () => void } {
  const constructor = getSpeechConstructor();
  if (!constructor) throw new Error('Speech input is not supported in this context.');

  const recognition = new constructor();
  const finalizedResults = new Set<number>();
  let aborted = false;

  recognition.lang = locale === 'en' ? 'en-US' : locale;
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    if (aborted) return;
    const transcripts: string[] = [];
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result.isFinal || finalizedResults.has(index)) continue;
      finalizedResults.add(index);
      const transcript = result[0]?.transcript.trim();
      if (transcript) transcripts.push(transcript);
    }
    if (transcripts.length > 0) callbacks.onTranscript(transcripts.join(' '));
  };
  recognition.onend = () => {
    if (!aborted) callbacks.onEnd();
  };
  recognition.onerror = (event) => {
    if (!aborted) callbacks.onError(event.error);
  };

  try {
    recognition.start();
  } catch (error) {
    aborted = true;
    recognition.onresult = null;
    recognition.onend = null;
    recognition.onerror = null;
    throw error;
  }

  return {
    stop: () => {
      if (!aborted) recognition.stop();
    },
    abort: () => {
      if (aborted) return;
      // Already queued handlers can outlive detachment, so they also check aborted.
      aborted = true;
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
    },
  };
}
