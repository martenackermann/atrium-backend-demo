import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { createZodDto } from 'nestjs-zod';
import { toRef, toRefOrNull, toUserRefOrNull } from '@/common/domain/mappers';
import { refSchema } from '@/common/domain/schemas';
import { PrismaService } from '@/database/prisma.service';
import { CostCenterDto, DepartmentDto, ListCostCentersQuery } from './users.dto';

class SiteDto extends createZodDto(refSchema.extend({})) {}

@ApiTags('org')
@Controller('org')
export class OrgController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('departments')
  @ZodResponse({ type: [DepartmentDto] })
  async departments(): Promise<DepartmentDto[]> {
    const rows = await this.prisma.department.findMany({
      orderBy: { code: 'asc' },
      include: { head: true, _count: { select: { members: { where: { active: true } } } } },
    });
    return rows.map((d) => ({ ...toRef(d), head: toUserRefOrNull(d.head), memberCount: d._count.members }));
  }

  @Get('sites')
  @ZodResponse({ type: [SiteDto] })
  async sites(): Promise<SiteDto[]> {
    return (await this.prisma.site.findMany({ orderBy: { code: 'asc' } })).map(toRef);
  }

  @Get('cost-centers')
  @ZodResponse({ type: [CostCenterDto] })
  async costCenters(@Query() query: ListCostCentersQuery): Promise<CostCenterDto[]> {
    const rows = await this.prisma.costCenter.findMany({
      where: query.active === undefined ? {} : { active: query.active },
      orderBy: { code: 'asc' },
      include: { department: true },
    });
    return rows.map((c) => ({ ...toRef(c), department: toRefOrNull(c.department), active: c.active }));
  }
}
