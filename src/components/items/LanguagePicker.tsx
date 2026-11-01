"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { codeLanguageChoice, codeLanguageChoices } from "@/lib/items/code-language";

interface LanguagePickerProps {
  id: string;
  /** The stored language: empty for none, and possibly free text from before the picker. */
  value: string;
  onChange: (language: string) => void;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
}

/**
 * The item form's language field: a searchable list in a popover. Clicking the
 * chosen row only closes it, so an old value like "ts", shown as TypeScript,
 * stays as stored until something else is picked.
 *
 * `modal`: see `CollectionPicker`; this sits in the same dialog and drawer.
 */
export const LanguagePicker = ({ id, value, onChange, ariaDescribedBy, ariaInvalid }: LanguagePickerProps) => {
  const [open, setOpen] = useState(false);
  const chosen = codeLanguageChoice(value);

  const pick = (language: string, isChosen: boolean) => {
    if (!isChosen) onChange(language);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid || undefined}
          className="w-full justify-between font-normal"
        >
          <span className={chosen ? "truncate" : "text-muted-foreground"}>
            {chosen?.label ?? "Choose a language"}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        {/* Opens on the chosen row: left to cmdk, Enter would hit No language and clear it. */}
        <Command defaultValue={chosen?.value}>
          <CommandInput placeholder="Search languages…" />
          <CommandList>
            <CommandEmpty>No language matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="no language" data-checked={!chosen} onSelect={() => pick("", !chosen)}>
                No language
              </CommandItem>
              {codeLanguageChoices(value).map((option) => {
                const isChosen = option.value === chosen?.value;
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, ...option.keywords]}
                    // cmdk owns aria-selected (the highlighted row); this drives the check mark.
                    data-checked={isChosen}
                    onSelect={() => pick(option.value, isChosen)}
                  >
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
