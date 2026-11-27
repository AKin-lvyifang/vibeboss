"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from "@animate-ui/react/icons";

type LibraryProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    leaning: {
      initial: { rotate: 0 },
      animate: {
        rotate: [0, -16, 0],
        transition: { duration: 0.8, times: [0, 0.45, 1], ease: "easeInOut" },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: LibraryProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <motion.path
        d="m16 6 4 14"
        style={{ transformOrigin: "20px 20px", transformBox: "view-box" }}
        variants={variants.leaning ?? {}}
        initial="initial"
        animate={controls ?? "initial"}
      />
      <path d="M12 6v14" />
      <path d="M8 8v12" />
      <path d="M4 4v16" />
    </motion.svg>
  );
}

function Library(props: LibraryProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export { Library as LibraryIcon };
