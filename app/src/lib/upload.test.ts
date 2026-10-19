import { beforeEach, describe, expect, it, vi } from 'vitest'

const upload = vi.fn<(path: string, form: FormData) => Promise<unknown[]>>()
vi.mock('./api/client', () => ({ api: { upload: (path: string, form: FormData) => upload(path, form) } }))

import { MAX_FILES_PER_UPLOAD, chunk, uploadInBatches } from './upload'

const files = (n: number) => Array.from({ length: n }, (_, i) => new File([`f${i}`], `f${i}.txt`))

beforeEach(() => {
  upload.mockReset()
  upload.mockImplementation(async (_path, form) => form.getAll('file').map((f) => ({ name: (f as File).name })))
})

describe('chunk', () => {
  it('режет список на пачки', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
    expect(chunk([1, 2], 5)).toEqual([[1, 2]])
  })
})

describe('uploadInBatches', () => {
  it('один запрос на пачку, поля в каждой форме, результаты по порядку', async () => {
    const total = MAX_FILES_PER_UPLOAD * 2 + 3
    const result = await uploadInBatches<{ name: string }>('/files', files(total), { folder_id: 'd1', wiki_page_id: null })
    expect(result).toHaveLength(total)
    expect(result[0].name).toBe('f0.txt')
    expect(result.at(-1)?.name).toBe(`f${total - 1}.txt`)
    expect(upload).toHaveBeenCalledTimes(3)
    const forms = upload.mock.calls.map(([, form]) => form)
    expect(forms.map((f) => f.getAll('file').length)).toEqual([MAX_FILES_PER_UPLOAD, MAX_FILES_PER_UPLOAD, 3])
    expect(forms.every((f) => f.get('folder_id') === 'd1')).toBe(true)
    expect(forms.every((f) => !f.has('wiki_page_id'))).toBe(true)
  })

  it('имя файла уходит как есть', async () => {
    await uploadInBatches('/files', [new File(['x'], 'Отчёт 100%.pdf')])
    expect((upload.mock.calls[0][1].get('file') as File).name).toBe('Отчёт 100%.pdf')
  })

  it('ошибка пачки уходит наружу и дальнейшие пачки не отправляются', async () => {
    upload.mockResolvedValueOnce([{}]).mockRejectedValueOnce(new Error('413'))
    await expect(uploadInBatches('/files', files(MAX_FILES_PER_UPLOAD * 3))).rejects.toThrow('413')
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('без файлов запросов нет', async () => {
    expect(await uploadInBatches('/files', [])).toEqual([])
    expect(upload).not.toHaveBeenCalled()
  })
})
