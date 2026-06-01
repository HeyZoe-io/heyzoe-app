"use client";

import { Input } from "@/components/ui/input";
import {
  WA_BUTTON_LABEL_MAX_CHARS,
  clampWaButtonLabelInput,
} from "@/lib/wa-button-label";

type WaButtonLabelInputProps = Omit<React.ComponentProps<typeof Input>, "onChange" | "value" | "maxLength"> & {
  value: string;
  onValueChange: (value: string) => void;
};

/** שדה תווית כפתור לווטסאפ — מוגבל ל־{WA_BUTTON_LABEL_MAX_CHARS} תווים */
export function WaButtonLabelInput({ value, onValueChange, ...rest }: WaButtonLabelInputProps) {
  return (
    <Input
      dir="rtl"
      maxLength={WA_BUTTON_LABEL_MAX_CHARS}
      value={value}
      onChange={(e) => onValueChange(clampWaButtonLabelInput(e.target.value))}
      {...rest}
    />
  );
}

export { WA_BUTTON_LABEL_MAX_CHARS };
