import { Module } from '@nestjs/common';
import { RelationshipsService } from './relationships.service';
import { RelationshipsController } from './relationships.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
    Relationship,
    RelationshipSchema,
} from './schemas/relationship.schema';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Relationship.name, schema: RelationshipSchema },
        ]),
        UsersModule,
    ],
    controllers: [RelationshipsController],
    providers: [RelationshipsService],
    exports: [RelationshipsService],
})
export class RelationshipsModule {}
