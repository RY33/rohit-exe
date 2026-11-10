import assert from "node:assert/strict";
import test from "node:test";

class FakeAudio extends EventTarget {
  static instances = [];

  preload = "";
  src = "";
  loop = false;
  volume = 1;
  readyState = 1;
  duration = 30;
  currentTime = 0;
  paused = true;
  error = null;

  constructor(src = "") {
    super();
    this.src = src;
    FakeAudio.instances.push(this);
  }

  load() {}

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  removeAttribute(attribute) {
    if (attribute === "src") {
      this.src = "";
    }
  }
}

test("initialization music stops, resets, and reuses the preloaded audio", async () => {
  FakeAudio.instances = [];
  globalThis.Audio = FakeAudio;
  globalThis.window = {};

  const { MemeAudioController } = await import("./MemeAudioController.ts");
  const controller = new MemeAudioController();
  controller.preloadAssets();

  assert.equal(FakeAudio.instances.length, 3);
  await controller.startMusic(() => assert.fail("Music playback failed"));

  const music = FakeAudio.instances.find((audio) =>
    audio.src.includes("spinning-cat.mp3"),
  );
  assert.ok(music);
  assert.equal(music.paused, false);

  music.currentTime = 12;
  controller.stopMusic();

  assert.equal(music.paused, true);
  assert.equal(music.volume, 0);
  assert.equal(music.currentTime, 0);

  await controller.startMusic(() => assert.fail("Music playback failed"));
  assert.equal(FakeAudio.instances.length, 3);
  assert.equal(music.paused, false);
  assert.equal(music.volume, 1);

  controller.dispose();
});

test("shortlisting reactions play their existing local audio assets", async () => {
  FakeAudio.instances = [];
  globalThis.Audio = FakeAudio;
  globalThis.window = {};

  const { MemeAudioController } = await import("./MemeAudioController.ts");
  const controller = new MemeAudioController();
  controller.preloadAssets();

  for (const [reaction, path] of [
    ["happy-cat", "/assets/memes/happy-cat.mp3"],
    ["cooked-dog", "/assets/memes/cooked-dog.mp3"],
  ]) {
    await controller.playReaction(reaction, (message) => assert.fail(message));
    const audio = FakeAudio.instances.find((instance) =>
      instance.src.endsWith(path),
    );
    assert.ok(audio);
    assert.equal(audio.paused, false);
  }

  controller.dispose();
});
