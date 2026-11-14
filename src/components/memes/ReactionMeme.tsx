"use client";

import { motion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";
import type { BackendVoiceEvent } from "@/lib/types";

type ReactionStatus = "happy_reaction" | "sad_reaction";

interface ReactionMemeProps {
  status: ReactionStatus;
  shortlisted: boolean;
  audioError: string;
  onDiagnostic: (event: BackendVoiceEvent, detail?: string) => void;
  onPresentationReady: (imageVisible: boolean) => void;
}

export default function ReactionMeme({
  status,
  shortlisted,
  audioError,
  onDiagnostic,
  onPresentationReady,
}: ReactionMemeProps) {
  const [assetState, setAssetState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [entranceComplete, setEntranceComplete] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    () =>
      typeof document === "undefined" ||
      document.visibilityState === "visible",
  );
  const backdropRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const fallbackRef = useRef<HTMLParagraphElement>(null);
  const lastVisibilityRef = useRef<string | null>(null);
  const presentationReadyRef = useRef(false);
  const isHappy = status === "happy_reaction";
  const assetPath = shortlisted
    ? "/assets/memes/happy-cat.gif"
    : "/assets/memes/cooked-dog.jpg";
  const label = shortlisted ? "Happy cat" : "Cooked dog";

  useLayoutEffect(() => {
    const handleVisibilityChange = () => {
      setDocumentVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    const backdropStyle = backdrop ? getComputedStyle(backdrop) : null;
    onDiagnostic(
      isHappy ? "happy_reaction.entered" : "sad_reaction.entered",
      `reactState=${status}; documentVisibility=${document.visibilityState}; backdropDisplay=${backdropStyle?.display ?? "unavailable"}; backdropVisibility=${backdropStyle?.visibility ?? "unavailable"}; backdropOpacity=${backdropStyle?.opacity ?? "unavailable"}; imageLoaded=false`,
    );
    onDiagnostic(
      isHappy ? "happy_cat.component.mounted" : "reaction_meme.component.mounted",
      `reactState=${status}`,
    );
    onDiagnostic(
      isHappy ? "happy_cat.image.loading" : "reaction_meme.image.loading",
      assetPath,
    );
  }, [assetPath, isHappy, onDiagnostic, status]);

  useLayoutEffect(() => {
    if (!entranceComplete || assetState === "loading") {
      return;
    }

    const backdrop = backdropRef.current;
    const visual = visualRef.current;
    const image = imageRef.current;
    const fallback = fallbackRef.current;
    if (!backdrop || !visual) {
      return;
    }

    const backdropStyle = getComputedStyle(backdrop);
    const visualStyle = getComputedStyle(visual);
    const backdropRect = backdrop.getBoundingClientRect();
    const visualRect = visual.getBoundingClientRect();
    const backdropVisible =
      backdropStyle.display !== "none" &&
      backdropStyle.visibility !== "hidden" &&
      Number(backdropStyle.opacity) > 0 &&
      backdropRect.width > 0 &&
      backdropRect.height > 0;
    const visualVisible =
      visualStyle.display !== "none" &&
      visualStyle.visibility !== "hidden" &&
      Number(visualStyle.opacity) > 0 &&
      visualRect.width > 0 &&
      visualRect.height > 0;
    const imageStyle = image ? getComputedStyle(image) : null;
    const imageRect = image?.getBoundingClientRect();
    const imageVisible = Boolean(
      assetState === "loaded" &&
        image &&
        imageStyle &&
        imageRect &&
        image.naturalWidth > 0 &&
        imageStyle.display !== "none" &&
        imageStyle.visibility !== "hidden" &&
        Number(imageStyle.opacity) > 0 &&
        imageRect.width > 0 &&
        imageRect.height > 0,
    );
    const fallbackStyle = fallback ? getComputedStyle(fallback) : null;
    const fallbackRect = fallback?.getBoundingClientRect();
    const fallbackVisible = Boolean(
      assetState === "error" &&
        fallback &&
        fallbackStyle &&
        fallbackRect &&
        fallbackStyle.display !== "none" &&
        fallbackStyle.visibility !== "hidden" &&
        Number(fallbackStyle.opacity) > 0 &&
        fallbackRect.width > 0 &&
        fallbackRect.height > 0,
    );
    const presentationVisible =
      documentVisible &&
      backdropVisible &&
      visualVisible &&
      (imageVisible || fallbackVisible);
    const visibilityDetail =
      `documentVisible=${documentVisible}; imageVisible=${imageVisible}; fallbackVisible=${fallbackVisible}; presentationVisible=${presentationVisible}; backdropDisplay=${backdropStyle.display}; backdropVisibility=${backdropStyle.visibility}; backdropOpacity=${backdropStyle.opacity}; visualDisplay=${visualStyle.display}; visualVisibility=${visualStyle.visibility}; assetState=${assetState}`;
    if (lastVisibilityRef.current !== visibilityDetail) {
      lastVisibilityRef.current = visibilityDetail;
      onDiagnostic(
        isHappy ? "happy_cat.visibility.changed" : "reaction_meme.visibility.changed",
        visibilityDetail,
      );
    }

    if (presentationVisible && !presentationReadyRef.current) {
      presentationReadyRef.current = true;
      if (imageVisible && isHappy) {
        onDiagnostic(
          "happy_cat.animation.started",
          "GIF image is loaded and visibly displayed",
        );
      }
      onPresentationReady(imageVisible);
    }
  }, [
    assetState,
    documentVisible,
    entranceComplete,
    isHappy,
    onDiagnostic,
    onPresentationReady,
  ]);

  return (
    <motion.div
      ref={backdropRef}
      className="reaction-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onAnimationStart={() => {
        onDiagnostic(
          isHappy
            ? "happy_reaction.backdrop.animation.started"
            : "sad_reaction.backdrop.animation.started",
        );
      }}
      onAnimationComplete={() => {
        onDiagnostic(
          isHappy
            ? "happy_reaction.backdrop.animation.completed"
            : "sad_reaction.backdrop.animation.completed",
        );
        setEntranceComplete(true);
      }}
      role="status"
      aria-live="polite"
    >
      <div className="reaction-modal">
        <div
          ref={visualRef}
          className="meme-visual relative flex h-52 w-52 items-center justify-center sm:h-64 sm:w-64"
          role="img"
          aria-label={label}
        >
          {assetState !== "error" ? (
            <img
              ref={imageRef}
              src={assetPath}
              alt={label}
              className="h-full w-full rounded-3xl border-2 border-[#111111] object-contain"
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth === 0 || image.naturalHeight === 0) {
                  setAssetState("error");
                  onDiagnostic(
                    isHappy
                      ? "happy_cat.image.error"
                      : "reaction_meme.image.error",
                    `${assetPath}; loaded with zero intrinsic dimensions`,
                  );
                  return;
                }
                setAssetState("loaded");
                onDiagnostic(
                  isHappy ? "happy_cat.image.loaded" : "reaction_meme.image.loaded",
                  `${assetPath}; naturalWidth=${image.naturalWidth}; naturalHeight=${image.naturalHeight}`,
                );
              }}
              onError={() => {
                setAssetState("error");
                onDiagnostic(
                  isHappy ? "happy_cat.image.error" : "reaction_meme.image.error",
                  assetPath,
                );
              }}
            />
          ) : (
            <p
              ref={fallbackRef}
              className="max-w-40 text-center text-sm text-[#111111]"
            >
              Could not load the {label} image. The reaction will continue
              without it.
            </p>
          )}
        </div>
        <h2 className="reaction-title">
          {shortlisted
            ? "I KNEW I HAD MAIN CHARACTER ENERGY!"
            : "IT'S OKAY... I'LL DEBUG MY PERSONALITY."}
        </h2>
        {audioError && (
          <p role="alert" className="reaction-error">
            {audioError}
          </p>
        )}
      </div>
    </motion.div>
  );
}
