import type { components } from './schema'

// Типы ответов и запросов API: берутся из схемы OpenAPI сервера (npm run gen-api), руками не пишутся.
type S = components['schemas']

export type User = S['UserDto']
export type Project = S['ProjectDto']
export type Column = S['ColumnDto']
export type Tag = S['TagDto']
export type Module = S['ModuleDto']
export type Milestone = S['MilestoneDto']
export type TaskCard = S['TaskCardDto']
export type TaskDetail = S['TaskDetailDto']
export type Subtask = S['SubtaskDto']
export type Comment = S['CommentDto']
export type TaskFile = S['TaskFileDto']
export type Board = S['BoardDto']
export type TokenResponse = S['TokenResponse']

export type UpdateTask = S['UpdateTask']
export type UpdateColumn = S['UpdateColumn']
export type UpdateSubtask = S['UpdateSubtask']
export type CreateColumn = S['CreateColumn']
export type CreateTask = S['CreateTask']

export type Priority = 'high' | 'med' | 'low'
