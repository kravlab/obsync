/**
 * Fills the `{name}` placeholders of a UI string with `values`, in one
 * pass, so a value is inserted literally even when it contains braces or
 * `$`. A placeholder with no value stays as written, which shows up in
 * the UI instead of failing.
 */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
	return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
		Object.prototype.hasOwnProperty.call(values, name) ? (values[name] ?? placeholder) : placeholder,
	);
}
