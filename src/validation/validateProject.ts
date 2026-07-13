import type {
  ConfigColumn,
  ConfigTable,
  ProjectFile,
  ValidationIssue,
} from '../model/types';
import type { Translator } from '../i18n';
import { identityNamespace } from '../model/schemaUtils';

const isEmpty = (value: unknown) => value === null || value === undefined || value === '';

const valueKey = (value: unknown) => `${typeof value}:${String(value)}`;
const CODE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const issueId = (
  tableId: string,
  rowId: string | undefined,
  columnId: string | undefined,
  code: string,
) => [tableId, rowId, columnId, code].filter(Boolean).join(':');

const findColumn = (table: ConfigTable | undefined, columnId: string | undefined) =>
  table?.columns.find((column) => column.id === columnId);

const isValidJsonValue = (value: unknown) => {
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }

  try {
    JSON.stringify(value);
    return value !== undefined && typeof value !== 'function' && typeof value !== 'symbol';
  } catch {
    return false;
  }
};

const validateType = (
  column: ConfigColumn,
  value: unknown,
  project: ProjectFile,
): string | undefined => {
  if (isEmpty(value)) return undefined;

  if (column.type === 'int') {
    return typeof value === 'number' && Number.isInteger(value) ? undefined : 'validationTypeInt';
  }

  if (column.type === 'float') {
    return typeof value === 'number' && Number.isFinite(value) ? undefined : 'validationTypeFloat';
  }

  if (column.type === 'string') {
    return typeof value === 'string' ? undefined : 'validationTypeString';
  }

  if (column.type === 'bool') {
    return typeof value === 'boolean' ? undefined : 'validationTypeBool';
  }

  if (column.type === 'enum') {
    return typeof value === 'string' && (column.enumValues ?? []).includes(value)
      ? undefined
      : 'validationTypeEnum';
  }

  if (column.type === 'json') {
    return isValidJsonValue(value) ? undefined : 'validationTypeJson';
  }

  if (column.type === 'ref') {
    const targetTable = project.tables.find((table) => table.id === column.ref?.tableId);
    const targetColumn = findColumn(targetTable, column.ref?.columnId);
    if (!targetTable || !targetColumn) return undefined;

    const targetValues = new Set(
      targetTable.rows
        .map((row) => row.values[targetColumn.id])
        .filter((targetValue) => !isEmpty(targetValue))
        .map(valueKey),
    );

    return targetValues.has(valueKey(value)) ? undefined : 'validationTypeRef';
  }

  return undefined;
};

export function validateProject(project: ProjectFile, t: Translator): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const registryEntries = new Map<string, { tableId: string; rowId: string }>();

  const pushIssue = (issue: Omit<ValidationIssue, 'id'>, code: string) => {
    issues.push({
      id: issueId(issue.tableId, issue.rowId, issue.columnId, code),
      ...issue,
    });
  };

  for (const table of project.tables) {
    const primaryColumns = table.columns.filter((column) => column.primary);
    const identity = table.identity;
    const identityKeyColumn = findColumn(table, identity?.keyColumnId);
    const identityValueColumn = findColumn(table, identity?.valueColumnId);

    if (primaryColumns.length > 1) {
      pushIssue(
        {
          severity: 'error',
          tableId: table.id,
          message: t('validationMultiplePrimary', { table: table.name }),
        },
        'multiple-primary',
      );
    }

    for (const column of table.columns) {
      if (!column.name.trim()) {
        pushIssue(
          {
            severity: 'error',
            tableId: table.id,
            columnId: column.id,
            message: t('validationUnnamedField', { table: table.name }),
          },
          'column-name-empty',
        );
      }

      if (column.primary && !column.required) {
        pushIssue(
          {
            severity: 'error',
            tableId: table.id,
            columnId: column.id,
            message: t('validationPrimaryNotRequired', {
              table: table.name,
              column: column.name,
            }),
          },
          'primary-not-required',
        );
      }

      if (column.type === 'enum' && (column.enumValues ?? []).length === 0) {
        pushIssue(
          {
            severity: 'warning',
            tableId: table.id,
            columnId: column.id,
            message: t('validationEnumEmpty', { table: table.name, column: column.name }),
          },
          'enum-empty',
        );
      }

      if (column.type === 'ref') {
        const targetTable = project.tables.find((item) => item.id === column.ref?.tableId);
        const targetColumn = findColumn(targetTable, column.ref?.columnId);

        if (!column.ref?.tableId || !column.ref?.columnId) {
          pushIssue(
            {
              severity: 'error',
              tableId: table.id,
              columnId: column.id,
              message: t('validationRefMissing', { table: table.name, column: column.name }),
            },
            'ref-missing',
          );
        } else if (!targetTable || !targetColumn) {
          pushIssue(
            {
              severity: 'error',
              tableId: table.id,
              columnId: column.id,
              message: t('validationRefTargetMissing', {
                table: table.name,
                column: column.name,
              }),
            },
            'ref-target-missing',
          );
        }
      }
    }

    for (const primaryColumn of primaryColumns) {
      const seen = new Map<string, string>();

      for (const row of table.rows) {
        const value = row.values[primaryColumn.id];
        if (isEmpty(value)) {
          pushIssue(
            {
              severity: 'error',
              tableId: table.id,
              rowId: row._rowId,
              columnId: primaryColumn.id,
              message: t('validationPrimaryEmpty', {
                table: table.name,
                column: primaryColumn.name,
              }),
            },
            'primary-empty',
          );
          continue;
        }

        const key = valueKey(value);
        const firstRowId = seen.get(key);
        if (firstRowId) {
          pushIssue(
            {
              severity: 'error',
              tableId: table.id,
              rowId: row._rowId,
              columnId: primaryColumn.id,
              message: t('validationPrimaryDuplicate', {
                table: table.name,
                column: primaryColumn.name,
                rowId: firstRowId,
              }),
            },
            'primary-duplicate',
          );
        } else {
          seen.set(key, row._rowId);
        }
      }
    }

    if (identity?.keyColumnId || identity?.valueColumnId || identity?.namespace !== undefined) {
      const namespace = identityNamespace(table);

      if (!namespace.trim()) {
        pushIssue(
          {
            severity: 'error',
            tableId: table.id,
            message: t('validationIdentityNamespaceEmpty', { table: table.name }),
          },
          'identity-namespace-empty',
        );
      }

      if (!identityKeyColumn) {
        pushIssue(
          {
            severity: 'error',
            tableId: table.id,
            message: t('validationIdentityKeyFieldMissing', { table: table.name }),
          },
          'identity-key-field-missing',
        );
      }

      if (!identityValueColumn) {
        pushIssue(
          {
            severity: 'error',
            tableId: table.id,
            message: t('validationIdentityValueFieldMissing', { table: table.name }),
          },
          'identity-value-field-missing',
        );
      }

      if (identityKeyColumn && identityValueColumn) {
        const seenKeys = new Map<string, string>();
        const seenValues = new Map<string, string>();

        for (const row of table.rows) {
          const key = row.values[identityKeyColumn.id];
          const runtimeValue = row.values[identityValueColumn.id];

          if (isEmpty(runtimeValue)) {
            continue;
          }

          if (isEmpty(key)) {
            pushIssue(
              {
                severity: 'error',
                tableId: table.id,
                rowId: row._rowId,
                columnId: identityKeyColumn.id,
                message: t('validationIdentityKeyEmpty', {
                  table: table.name,
                  column: identityKeyColumn.name,
                }),
              },
              'identity-key-empty',
            );
          } else {
            const keyText = String(key);
            if (!CODE_KEY_PATTERN.test(keyText)) {
              pushIssue(
                {
                  severity: 'error',
                  tableId: table.id,
                  rowId: row._rowId,
                  columnId: identityKeyColumn.id,
                  message: t('validationIdentityInvalidKey', {
                    table: table.name,
                    column: identityKeyColumn.name,
                  }),
                },
                'identity-key-invalid',
              );
            }

            const duplicateKeyRowId = seenKeys.get(keyText);
            if (duplicateKeyRowId) {
              pushIssue(
                {
                  severity: 'error',
                  tableId: table.id,
                  rowId: row._rowId,
                  columnId: identityKeyColumn.id,
                  message: t('validationIdentityKeyDuplicate', {
                    table: table.name,
                    column: identityKeyColumn.name,
                    rowId: duplicateKeyRowId,
                  }),
                },
                'identity-key-duplicate',
              );
            } else {
              seenKeys.set(keyText, row._rowId);
            }

            const entry = `${namespace}.${keyText}`;
            const duplicateEntry = registryEntries.get(entry);
            if (duplicateEntry) {
              pushIssue(
                {
                  severity: 'error',
                  tableId: table.id,
                  rowId: row._rowId,
                  columnId: identityKeyColumn.id,
                  message: t('validationIdentityDuplicateEntry', { entry }),
                },
                'identity-registry-entry-duplicate',
              );
            } else {
              registryEntries.set(entry, { tableId: table.id, rowId: row._rowId });
            }
          }

          const runtimeValueKey = valueKey(runtimeValue);
          const duplicateValueRowId = seenValues.get(runtimeValueKey);
          if (duplicateValueRowId) {
            pushIssue(
              {
                severity: 'error',
                tableId: table.id,
                rowId: row._rowId,
                columnId: identityValueColumn.id,
                message: t('validationIdentityValueDuplicate', {
                  table: table.name,
                  column: identityValueColumn.name,
                  rowId: duplicateValueRowId,
                }),
              },
              'identity-value-duplicate',
            );
          } else {
            seenValues.set(runtimeValueKey, row._rowId);
          }
        }
      }
    }

    for (const row of table.rows) {
      for (const column of table.columns) {
        const value = row.values[column.id];

        if (column.required && isEmpty(value)) {
          pushIssue(
            {
              severity: 'error',
              tableId: table.id,
              rowId: row._rowId,
              columnId: column.id,
              message: t('validationRequired', { table: table.name, column: column.name }),
            },
            'required-empty',
          );
          continue;
        }

        const typeError = validateType(column, value, project);
        if (typeError) {
          pushIssue(
            {
              severity: 'error',
              tableId: table.id,
              rowId: row._rowId,
              columnId: column.id,
              message: t(typeError as Parameters<Translator>[0], {
                table: table.name,
                column: column.name,
              }),
            },
            `type-${column.type}`,
          );
        }
      }
    }
  }

  return issues;
}
