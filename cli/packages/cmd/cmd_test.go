package cmd

import (
	"testing"

	"github.com/Infisical/infisical-merge/packages/models"
)

func TestFilterReservedEnvVars(t *testing.T) {

	// some test env vars.
	// HOME and PATH are reserved keywords and should be filtered out
	// XDG_SESSION_ID and LC_CTYPE are reserved key word prefixes and should be filtered out
	// The filter function only checks the keys of the env map, so we don't need to set any values
	env := map[string]models.SingleEnvironmentVariable{
		"test":           {},
		"test2":          {},
		"HOME":           {},
		"PATH":           {},
		"XDG_SESSION_ID": {},
		"LC_CTYPE":       {},
	}

	// check to see if there are any reserved keywords in secrets to inject
	filterReservedEnvVars(env)

	if len(env) != 2 {
		t.Errorf("Expected 2 secrets to be returned, got %d", len(env))
	}
	if _, ok := env["test"]; !ok {
		t.Errorf("Expected test to be returned")
	}
	if _, ok := env["test2"]; !ok {
		t.Errorf("Expected test2 to be returned")
	}
	if _, ok := env["HOME"]; ok {
		t.Errorf("Expected HOME to be filtered out")
	}
	if _, ok := env["PATH"]; ok {
		t.Errorf("Expected PATH to be filtered out")
	}
	if _, ok := env["XDG_SESSION_ID"]; ok {
		t.Errorf("Expected XDG_SESSION_ID to be filtered out")
	}
	if _, ok := env["LC_CTYPE"]; ok {
		t.Errorf("Expected LC_CTYPE to be filtered out")
	}

}

func TestEscapeChars(t *testing.T) {
	type testCase struct {
		input    string
		expected string
	}

	testCases := []testCase{
		{
			input:    `test`,
			expected: `test`,
		},
		{
			input:    `test"`,
			expected: `test\"`,
		},
		{
			input:    `test"test`,
			expected: `test\"test`,
		},
		{
			input:    `test"test""`,
			expected: `test\"test\"\"`,
		},
		{
			input:    `test"test"-'test'`,
			expected: `test\"test\"-'test'`,
		},
	}

	for _, tc := range testCases {
		actual := escapeChars(tc.input)
		if actual != tc.expected {
			t.Errorf("Expected %s, got %s", tc.expected, actual)
		}
	}
}

func TestBuildExecCmd(t *testing.T) {
	type testCase struct {
		input    []string
		expected string
	}

	testCases := []testCase{
		{
			input:    []string{"test"},
			expected: `test`,
		},
		{
			input:    []string{"ls", "-l"},
			expected: `ls -l`,
		},
		{
			input:    []string{"echo", `"this is a test"`},
			expected: `echo \"this is a test\"`,
		},
		{
			input:    []string{"echo", `"this is a test with \"quotes\""`},
			expected: `echo \"this is a test with \\\"quotes\\\"\"`,
		},
		{
			input:    []string{"echo", `\"`, "something", `\"`},
			expected: `echo \\\" something \\\"`,
		},
		{
			input:    []string{"echo", `\'`, "something", `\'`},
			expected: `echo \\' something \\'`,
		},
	}

	for _, tc := range testCases {
		actual := buildExecCmd(tc.input)
		if actual != tc.expected {
			t.Errorf("Expected %s, got %s", tc.expected, actual)
		}
	}
}
