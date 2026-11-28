import { Progress as ProgressPrimitive } from "@animate-ui/react/primitives/base-ui/progress";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

function Progress({ className, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("flex w-full flex-col items-center gap-2.5", className)}
      {...props}
    />
  );
}

function ProgressTrack({
  className,
  indicatorTransition,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Track> & {
  readonly indicatorTransition?: React.ComponentProps<
    typeof ProgressPrimitive.Indicator
  >["transition"];
}) {
  return (
    <ProgressPrimitive.Track
      data-slot="progress-track"
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 rounded-full bg-primary"
        {...(indicatorTransition === undefined ? {} : { transition: indicatorTransition })}
      />
    </ProgressPrimitive.Track>
  );
}

const progressValueVariants = cva("tabular-nums", {
  defaultVariants: { size: "default" },
  variants: {
    size: {
      default: "text-sm",
      display: "font-semibold text-3xl tracking-tight",
    },
  },
});

function ProgressValue({
  className,
  size,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Value> &
  VariantProps<typeof progressValueVariants>) {
  return (
    <ProgressPrimitive.Value
      data-slot="progress-value"
      className={cn(progressValueVariants({ size }), className)}
      {...props}
    />
  );
}

export { Progress, ProgressTrack, ProgressValue };
