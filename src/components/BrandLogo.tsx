interface BrandLogoProps {
  className?: string
}

export default function BrandLogo({ className = '' }: BrandLogoProps) {
  return (
    <span className={`font-bold uppercase text-[#e8f4fd] ${className}`}>
      Lepto<span className="text-[#38bdf8]">Trials</span>
    </span>
  )
}
