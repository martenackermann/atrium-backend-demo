import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '@/common/auth/password-hasher';
import { ProblemException } from '@/common/http/problem';
import { Clock } from '@/common/time/clock.service';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import { effectiveRoles } from '../users/principal.service';
import { UsersService } from '../users/users.service';
import type { LoginResponseDto, PersonaDto } from './auth.dto';
import { PERSONAS } from './personas.catalog';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  /** Verifying unknown emails against a real hash keeps response times similar. */
  private readonly dummyHash = hashPassword(randomUUID());

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async login(email: string, password: string, userAgent?: string): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const valid = await verifyPassword(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user || !valid || !user.active) throw ProblemException.invalidCredentials();
    return this.startSession(user.id, user.email, userAgent);
  }

  async demoLogin(personaKey: string, userAgent?: string): Promise<LoginResponseDto> {
    this.assertDemoMode();
    const user = await this.prisma.user.findUnique({ where: { personaKey } });
    if (!user?.active) throw ProblemException.notFound('Persona');
    return this.startSession(user.id, user.email, userAgent);
  }

  async logout(sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  async personas(): Promise<PersonaDto[]> {
    this.assertDemoMode();
    const rows = await this.prisma.user.findMany({
      where: { personaKey: { not: null }, active: true },
      include: {
        department: true,
        roles: { select: { role: true } },
        _count: { select: { directReports: { where: { active: true } } } },
      },
    });
    const byKey = new Map(rows.map((row) => [row.personaKey, row]));
    return PERSONAS.flatMap((persona) => {
      const user = byKey.get(persona.key);
      if (!user) return [];
      return [
        {
          key: persona.key,
          displayName: user.displayName,
          email: user.email,
          jobTitle: user.jobTitle ?? '',
          department: user.department?.name ?? '',
          roles: effectiveRoles(
            user.roles.map((r) => r.role),
            user._count.directReports > 0,
          ),
          tagline: persona.tagline,
          highlights: persona.highlights,
        },
      ];
    });
  }

  private assertDemoMode(): void {
    if (!this.config.get('DEMO_MODE')) throw ProblemException.notFound();
  }

  private async startSession(userId: string, email: string, userAgent?: string): Promise<LoginResponseDto> {
    const issued = await this.tokens.issue({ id: userId, email });
    await this.prisma.$transaction([
      this.prisma.authSession.create({
        data: {
          id: issued.sessionId,
          userId,
          expiresAt: issued.expiresAt,
          userAgent: userAgent?.slice(0, 200) ?? null,
        },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: this.clock.now() } }),
    ]);
    return {
      accessToken: issued.accessToken,
      tokenType: 'Bearer',
      expiresAt: issued.expiresAt.toISOString(),
      user: await this.users.me(userId),
    };
  }
}
