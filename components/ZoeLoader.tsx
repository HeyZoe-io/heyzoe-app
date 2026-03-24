"use client";

import { motion } from "framer-motion";

type ZoeLoaderProps = {
  color?: string;
};

export default function ZoeLoader({ color = "#FFD646" }: ZoeLoaderProps) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-white/65 backdrop-blur-sm">
      <motion.div
        className="relative flex h-20 w-20 items-center justify-center rounded-full shadow-[0_0_40px_rgba(255,214,70,0.35)]"
        style={{ backgroundColor: color }}
        animate={{ scale: [1, 1.1, 1], rotate: [0, 8, -8, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="text-xl font-semibold text-zinc-900/80 select-none">Z</span>
      </motion.div>
    </div>
  );
}
