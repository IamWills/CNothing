import { brand } from "@/lib/brand";

/**
 * Banner for pre-v3 / parallel console surfaces that remain for migration.
 */
export function LegacyBanner({
  preferredHref = brand.recommendedPath,
  preferredLabel = "v3 Dashboard",
  compact = false,
}: {
  preferredHref?: string;
  preferredLabel?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-[24px] border border-amber-200 bg-amber-50 text-amber-950 ${
        compact ? "px-4 py-3 text-sm" : "px-5 py-4 text-sm"
      }`}
      role="status"
    >
      <p className="font-semibold">Legacy / Migration surface</p>
      <p className={compact ? "mt-1" : "mt-2"}>
        The recommended path is the {brand.tagline}{" "}
        <a href={preferredHref} className="font-medium underline underline-offset-2">
          {preferredLabel}
        </a>
        . This page is kept for compatibility with v2 / v2.5 workflows.
      </p>
    </div>
  );
}
