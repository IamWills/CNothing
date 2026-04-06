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
      ? { frame: "h-14 w-14 rounded-[22px]", image: "h-12 w-12 rounded-[18px]", px: 48 }
      : size === "lg"
        ? { frame: "h-24 w-24 rounded-[34px]", image: "h-22 w-22 rounded-[28px]", px: 88 }
        : { frame: "h-18 w-18 rounded-[28px]", image: "h-16 w-16 rounded-[22px]", px: 64 };

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden border border-[color:var(--border)] bg-white p-1 shadow-[0_10px_30px_rgba(15,23,42,0.08)]",
        dimensions.frame,
        className,
      )}
    >
      <Image
        src={brand.logoPath}
        alt={`${brand.name} logo`}
        width={dimensions.px}
        height={dimensions.px}
        className={cn("object-cover", dimensions.image, imageClassName)}
        priority
      />
    </div>
  );
}
