/**
 * Ablage: Richtlinien & Vorschriften – PDFs in Ordnern, wie in einem
 * Dateibrowser. Die Dateien liegen wie alle PDFs unter /data/dokumente.
 */
import { index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { createdAt } from './common';
import { users } from './core';

/** Ordner; ohne `parentId` liegt er ganz oben. Löschen nimmt den Inhalt mit. */
export const policyFolders = sqliteTable(
	'policy_folders',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		parentId: integer('parent_id').references((): AnySQLiteColumn => policyFolders.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('policy_folders_parent_idx').on(t.parentId)]
);

/** Ein PDF mit selbst vergebenem Namen; ohne `folderId` liegt es ganz oben */
export const policyDocuments = sqliteTable(
	'policy_documents',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		folderId: integer('folder_id').references(() => policyFolders.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		fileName: text('file_name').notNull(),
		sha256: text('sha256').notNull(),
		size: integer('size').notNull(),
		uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('policy_documents_folder_idx').on(t.folderId)]
);
