import { join } from 'path'

export const DATA_DIR = process.env.ULTRADEV_DATA_DIR || join(process.env.HOME || '/tmp', '.ultradev')
export const MAINTENANCE_FILE = join(DATA_DIR, 'maintenance')
