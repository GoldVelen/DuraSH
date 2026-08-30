import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

type DuraSHBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the DuraSH geometric D and forward-arrow mark at the host's size.
 * @param props - Host-supplied mark presentation.
 * @returns the decorative DuraSH mark.
 */
export function DuraSHBrandMark({ size, className }: DuraSHBrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4" y="4" width="56" height="56" rx="15" fill="#0F172A" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15 11H31C42.598 11 52 20.402 52 32C52 43.598 42.598 53 31 53H15V11ZM24 20V44H31C37.627 44 43 38.627 43 32C43 25.373 37.627 20 31 20H24Z"
        fill="#E2E8F0"
      />
      <path d="M30 27H39V21L51 32L39 43V37H30V27Z" fill="#F59E0B" />
    </svg>
  )
}

/**
 * Render the DuraSH name as accessible text rather than outlined artwork.
 * @returns the DuraSH product name.
 */
export function DuraSHBrandName({ t }: PropsLocale<'durashBrand'>) {
  return <span>{t('name')}</span>
}
