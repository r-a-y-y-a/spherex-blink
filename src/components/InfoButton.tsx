import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { HelpTopic } from '@/lib/help'
import { cn } from '@/lib/utils'

/** Small (i) button that explains a group of controls in a popover. */
export function InfoButton({ topic, className }: { topic: HelpTopic; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Help: ${topic.title}`}
        className={cn(
          // The visible icon is small; the pseudo-element gives a ~32px tap target.
          'relative grid size-4 place-items-center rounded-full text-muted-foreground/70 transition before:absolute before:-inset-2 hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:text-primary',
          className,
        )}
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="max-h-[min(70svh,520px)] w-[min(22rem,calc(100vw-24px))] gap-3 overflow-y-auto border border-white/10 bg-popover/95 p-4 backdrop-blur"
      >
        <div>
          <p className="font-heading font-semibold">{topic.title}</p>
          {topic.intro && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{topic.intro}</p>}
        </div>
        <dl className="space-y-2.5">
          {topic.items.map((it) => (
            <div key={it.name}>
              <dt className="text-xs font-semibold text-foreground">{it.name}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{it.text}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  )
}
