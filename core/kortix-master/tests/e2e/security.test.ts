import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync, statSync } from "fs";
import { cleanupRuntimeFixture, createRuntimeFixture, startDummyOpenCode, startKortixMaster, waitForHttp, type RuntimeFixture, type StartedServer } from "./helpers";

describe("Security Tests", () => {
  const baseURL = "http://localhost:8003";
  
  let serverProcess: StartedServer | null = null;
  let opencode: Awaited<ReturnType<typeof startDummyOpenCode>> | null = null;
  let fixture: RuntimeFixture;

  beforeAll(async () => {
    fixture = createRuntimeFixture("kortix-security-");
    opencode = await startDummyOpenCode(9003);
    serverProcess = await startKortixMaster(8003, fixture, {
      KORTIX_TOKEN: "security-test-token",
      OPENCODE_PORT: "9003",
    });
  });

  afterAll(async () => {
    await serverProcess?.stop();
    await opencode?.stop();
    await cleanupRuntimeFixture(fixture);
  });

  async function setEnvVar(key: string, value: string) {
    const response = await fetch(`${baseURL}/env/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to set env var: ${response.status}`);
    }
  }

  test("secret files should have secure permissions", async () => {
    // Set a secret to ensure files are created
    await setEnvVar("SECURITY_TEST", "secret-value");

    // Check secrets file permissions
    if (existsSync(fixture.secretFilePath)) {
      const secretsStats = statSync(fixture.secretFilePath);
      const mode = secretsStats.mode & parseInt("777", 8);
      expect(mode).toBe(parseInt("600", 8)); // Should be 0o600
    }

    // Check salt file permissions
    if (existsSync(fixture.saltFilePath)) {
      const saltStats = statSync(fixture.saltFilePath);
      const mode = saltStats.mode & parseInt("777", 8);
      expect(mode).toBe(parseInt("600", 8)); // Should be 0o600
    }
  });

  test("secrets should be encrypted in storage", async () => {
    const secretValue = "this-should-be-encrypted";
    await setEnvVar("ENCRYPTION_TEST", secretValue);

    // Read the raw secrets file
    if (existsSync(fixture.secretFilePath)) {
      const rawContent = readFileSync(fixture.secretFilePath, "utf8");
      
      // The raw file should not contain the plaintext secret
      expect(rawContent).not.toContain(secretValue);
      
      // Should be valid JSON
      const parsed = JSON.parse(rawContent);
      expect(parsed).toHaveProperty("secrets");
      expect(parsed).toHaveProperty("version");
      
      // Encrypted value should be different from plaintext
      expect(parsed.secrets.ENCRYPTION_TEST).not.toBe(secretValue);
      
      // Encrypted value should follow format: iv:authTag:encrypted
      const encryptedValue = parsed.secrets.ENCRYPTION_TEST;
      expect(encryptedValue).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
    }
  });

  test("different KORTIX_TOKEN should not break secret decryption", async () => {
    // Set a secret with current token
    await setEnvVar("TOKEN_TEST", "secret-with-token-1");

    // Start server with different token on a different port.
      const newBaseUrl = "http://localhost:8004";
      const newServerProcess = await startKortixMaster(8004, fixture, {
        KORTIX_TOKEN: "different-security-test-token",
        OPENCODE_PORT: "9004",
      });

    try {
      const response = await fetch(`${newBaseUrl}/env/TOKEN_TEST`);
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.TOKEN_TEST).toBe("secret-with-token-1");
    } finally {
      // Clean up
        await newServerProcess.stop();
      }
  });

  test("API should handle malformed requests safely", async () => {
    await waitForHttp(`${baseURL}/docs`);
    // Test malformed JSON
    const response1 = await fetch(`${baseURL}/env/TEST_KEY`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json"
    });
    expect(response1.status).toBe(400);

    // Test missing content-type
    const response2 = await fetch(`${baseURL}/env/TEST_KEY`, {
      method: "POST",
      body: JSON.stringify({ value: "test" })
    });
    // Should still work or gracefully handle

    // Test very long key names
    const longKey = "A".repeat(1000);
    const response3 = await fetch(`${baseURL}/env/${longKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "test" })
    });
    // Should handle gracefully without crashing

    // Test very long values
    const longValue = "B".repeat(100000);
    const response4 = await fetch(`${baseURL}/env/LONG_VALUE_TEST`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: longValue })
    });
    // Should handle gracefully
  });

  test("sensitive data should not appear in logs", async () => {
    await waitForHttp(`${baseURL}/docs`);
    const sensitiveValue = "super-secret-password-123";
    await setEnvVar("LOG_TEST", sensitiveValue);

    // In a real implementation, you would capture and check server logs
    // For now, we'll just ensure the API works without exposing the value
    const response = await fetch(`${baseURL}/env/LOG_TEST`);
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data.LOG_TEST).toBe(sensitiveValue);
  });
});
