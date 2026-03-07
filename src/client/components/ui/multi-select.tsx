import * as React from "react"
import { useState, useRef, useEffect } from "react"
import { ChevronDown, X, Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface MultiSelectOption {
  value: number
  label: string
  detail?: string
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  selected: number[]
  onChange: (selected: number[]) => void
  placeholder?: string
}

export function MultiSelect({ options, selected, onChange, placeholder = "Select..." }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const toggle = (value: number) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const remove = (e: React.MouseEvent, value: number) => {
    e.stopPropagation()
    onChange(selected.filter(v => v !== value))
  }

  const selectedOptions = options.filter(o => selected.includes(o.value))

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen(!open)}
        className={cn(
          "flex min-h-9 w-full cursor-pointer items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
          "hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          open && "ring-1 ring-ring"
        )}
      >
        <div className="flex flex-wrap gap-1 flex-1">
          {selectedOptions.length === 0 && (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          {selectedOptions.map(o => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-xs"
            >
              {o.label}
              <button
                type="button"
                onClick={(e) => remove(e, o.value)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <ChevronDown className={cn("h-4 w-4 opacity-50 shrink-0 ml-2 transition-transform", open && "rotate-180")} />
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 py-1 shadow-lg max-h-48 overflow-y-auto">
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No options</div>
          )}
          {options.map(o => {
            const isSelected = selected.includes(o.value)
            return (
              <div
                key={o.value}
                onClick={() => toggle(o.value)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-zinc-800/70",
                  isSelected && "bg-zinc-800/40"
                )}
              >
                <div className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  isSelected ? "border-blue-500 bg-blue-500/20" : "border-zinc-600"
                )}>
                  {isSelected && <Check className="h-3 w-3 text-blue-400" />}
                </div>
                <span className="flex-1">{o.label}</span>
                {o.detail && <span className="text-xs text-muted-foreground font-mono">{o.detail}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
