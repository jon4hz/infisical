//go:build !windows

package cmd

import "strings"

// escapeChars replaces all double quotes and backslashes in the given string with escaped double quotes.
func escapeChars(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	return strings.ReplaceAll(s, `"`, `\"`)
}
