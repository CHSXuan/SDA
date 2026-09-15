/** SDA's omnidirectional sound-field mark; inherits the active theme accent. */
export function SdaLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M167 135 A150 150 0 0 1 345 135 M377 167 A150 150 0 0 1 377 345 M345 377 A150 150 0 0 1 167 377 M135 345 A150 150 0 0 1 135 167"
        stroke="currentColor" strokeWidth="21" strokeLinecap="round"
      />
      <path
        d="M294 194 C284 181 268 176 253 176 C223 176 207 191 207 211 C207 231 227 242 254 251 C283 261 305 273 305 298 C305 321 284 336 254 336 C234 336 217 329 205 317"
        stroke="currentColor" strokeWidth="30" strokeLinecap="round"
      />
    </svg>
  );
}
