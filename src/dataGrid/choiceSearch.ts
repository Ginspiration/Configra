export type ChoiceOption = {
  key: string;
  label: string;
  value: unknown;
};

const searchableValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const filterChoiceOptions = (options: ChoiceOption[], query: string) => {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options;

  return options.filter((option) => {
    const searchable = `${option.label} ${searchableValue(option.value)}`.toLocaleLowerCase();
    return tokens.every((token) => searchable.includes(token));
  });
};
