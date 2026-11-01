const COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-orange-500",
];

export default function Avatar({
  id,
  name,
  url,
  size = 44,
  online = false,
}: {
  id: string;
  name: string;
  url?: string | null;
  size?: number;
  online?: boolean;
}) {
  const color = COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="h-full w-full rounded-full object-cover" />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center rounded-full font-bold text-white ${color}`}
          style={{ fontSize: Math.round(size * 0.38) }}
        >
          {initials}
        </div>
      )}
      {online && (
        <span className="absolute bottom-0 left-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
      )}
    </div>
  );
}
