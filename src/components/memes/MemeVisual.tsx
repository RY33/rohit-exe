"use client";

import { useState } from "react";

interface MemeVisualProps {
  assetPath: string;
  label: string;
}

export default function MemeVisual({
  assetPath,
  label,
}: MemeVisualProps) {
  const [assetFailed, setAssetFailed] = useState(false);

  return (
    <div
      className="meme-visual relative flex h-52 w-52 items-center justify-center sm:h-64 sm:w-64"
      role="img"
      aria-label={label}
    >
      {!assetFailed ? (
        <img
          src={assetPath}
          alt={label}
          className="h-full w-full rounded-3xl border-2 border-[#111111] object-contain"
          onError={() => setAssetFailed(true)}
        />
      ) : (
        <p className="max-w-40 text-center text-sm text-[#111111]">
          Could not load the {label} GIF. Check the local asset at{" "}
          <code className="break-all">{assetPath}</code>.
        </p>
      )}
    </div>
  );
}
