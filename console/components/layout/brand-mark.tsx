import Image from "next/image";
import { cn } from "@/lib/utils";
import { brand } from "@/lib/brand";

export function BrandMark({
  size = "md",
  className,
  imageClassName,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  imageClassName?: string;
}) {
  const dimensions =
    size === "sm"
      ? { frame: "h-12 w-12", image: "h-12 w-12", px: 48 }
      : size === "lg"
        ? { frame: "h-22 w-22", image: "h-22 w-22", px: 88 }
        : { frame: "h-16 w-16", image: "h-16 w-16", px: 64 };

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden",
        dimensions.frame,
        className,
      )}
      style={{ clipPath: "circle(50% at 50% 50%)" }}
    >
      <Image
        src={brand.logoPath}
        alt={`${brand.name} logo`}
        width={dimensions.px}
        height={dimensions.px}
        className={cn("object-cover", dimensions.image, imageClassName)}
        style={{ clipPath: "circle(50% at 50% 50%)" }}
        priority
      />
    </div>
  );
}
