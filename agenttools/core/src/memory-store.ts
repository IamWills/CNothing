import type { CredentialStore, EnrollmentState } from "./types";

export class MemoryCredentialStore implements CredentialStore {
  private token = "";
  private enrollment: EnrollmentState | null = null;

  async readToken(): Promise<string> {
    return this.token;
  }

  async writeToken(token: string): Promise<void> {
    this.token = token;
    this.enrollment = null;
  }

  async readEnrollment(): Promise<EnrollmentState | null> {
    return this.enrollment;
  }

  async writeEnrollment(state: EnrollmentState | null): Promise<void> {
    this.enrollment = state;
  }
}
