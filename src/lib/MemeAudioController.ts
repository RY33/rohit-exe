export type ReactionAudio = "happy-cat" | "cooked-dog";

const audioPaths = {
  "spinning-cat": "/assets/memes/spinning-cat.mp3",
  "happy-cat": "/assets/memes/happy-cat.mp3",
  "cooked-dog": "/assets/memes/cooked-dog.mp3",
} as const;

export class MemeAudioController {
  private readonly preloadedAudio = new Map<string, HTMLAudioElement>();
  private currentAudio: HTMLAudioElement | null = null;
  private currentErrorHandler: (() => void) | null = null;
  private generation = 0;
  private disposed = false;

  preloadAssets(): void {
    if (this.disposed || typeof window === "undefined") {
      return;
    }

    for (const path of Object.values(audioPaths)) {
      if (this.preloadedAudio.has(path)) {
        continue;
      }

      const audio = new Audio();
      audio.preload = "auto";
      audio.src = path;
      audio.load();
      this.preloadedAudio.set(path, audio);
    }
  }

  startMusic(onError: (message: string) => void): Promise<void> {
    return this.playAsset("spinning-cat", true, onError);
  }

  playReaction(
    reaction: ReactionAudio,
    onError: (message: string) => void,
  ): Promise<void> {
    return this.playAsset(reaction, false, onError);
  }

  stopMusic(): void {
    this.stopAll();
  }

  stopAll(): void {
    this.generation += 1;
    if (this.currentAudio) {
      if (this.currentErrorHandler) {
        this.currentAudio.removeEventListener("error", this.currentErrorHandler);
      }
      this.currentAudio.volume = 0;
      this.currentAudio.pause();
      if (this.currentAudio.readyState > 0) {
        this.currentAudio.currentTime = 0;
      }
    }
    this.currentAudio = null;
    this.currentErrorHandler = null;
  }

  dispose(): void {
    this.stopAll();
    this.disposed = true;
    for (const audio of this.preloadedAudio.values()) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    this.preloadedAudio.clear();
  }

  private async playAsset(
    asset: keyof typeof audioPaths,
    loop: boolean,
    onError: (message: string) => void,
  ): Promise<void> {
    this.stopAll();
    if (this.disposed || typeof window === "undefined") {
      return;
    }

    const generation = this.generation;
    const path = audioPaths[asset];
    let audio = this.preloadedAudio.get(path);
    if (!audio) {
      audio = new Audio(path);
      audio.preload = "auto";
      this.preloadedAudio.set(path, audio);
    }

    audio.loop = loop;
    audio.volume = 1;
    if (audio.readyState > 0) {
      audio.currentTime = 0;
    }
    this.currentAudio = audio;

    const handleError = () => {
      if (generation !== this.generation || this.currentAudio !== audio) {
        return;
      }
      onError(`Could not load or play ${path}. Check that the local audio file exists and is supported.`);
      this.stopAll();
    };
    this.currentErrorHandler = handleError;
    audio.addEventListener("error", handleError, { once: true });

    if (audio.error) {
      handleError();
      return;
    }

    try {
      await audio.play();
    } catch (error) {
      if (generation !== this.generation || this.currentAudio !== audio) {
        return;
      }
      const detail = error instanceof Error ? ` ${error.message}` : "";
      onError(`Could not play ${path}.${detail}`);
      this.stopAll();
    }
  }
}
