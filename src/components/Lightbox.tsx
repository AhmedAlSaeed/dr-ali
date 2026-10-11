import { useEffect } from "react";
import { X } from "lucide-react";
import type { Picture } from "@/lib/deck";

export function Lightbox({ picture, onClose }: { picture: Picture | null; onClose: () => void }) {
  useEffect(() => {
    if (!picture) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [picture, onClose]);

  if (!picture) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={picture.alt || "Enlarged image"}
      className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute right-5 top-5 rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        onClick={onClose}
      >
        <X className="size-6" />
      </button>
      <img
        src={`${import.meta.env.BASE_URL}media/${picture.src}`}
        alt={picture.alt}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      {picture.alt && (
        <p className="absolute bottom-5 left-1/2 max-w-3xl -translate-x-1/2 text-center text-sm text-white/70">
          {picture.alt}
        </p>
      )}
    </div>
  );
}
