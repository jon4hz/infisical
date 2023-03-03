//go:build windows

package cmd

import "strings"

// escapeChars replaces all double quotes and backslashes in the given string with escaped double quotes.
// If the SHELL variable isn't set, we assume that the user is running infisical from CMD or PowerShell.
// In this case, we don't need to escape quotes.
// If the user is running infisical from something like Git Bash, the SHELL variable will be set, and we need to escape quotes.
func escapeChars(s string) string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		return s
	}
	s = strings.ReplaceAll(s, `\`, `\\`)
	return strings.ReplaceAll(s, `"`, `\"`)
}
