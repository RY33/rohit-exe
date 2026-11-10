import { Mic, Square } from "lucide-react";

interface SpeakButtonProps {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

export default function SpeakButton({
  active,
  disabled = false,
  label,
  onClick,
}: SpeakButtonProps) {
  const Icon = active ? Square : Mic;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`voice-button${active ? " voice-button-stop" : ""}`}
    >
      <Icon size={20} aria-hidden="true" />
      {label}
    </button>
  );
}
