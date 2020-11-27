import { ICreateFormOptions } from './types'
import { Form } from './models'
export * from './namespace'
export * from './effects'
export * from './effect'
export const createForm = (options: ICreateFormOptions) => {
  return new Form(options)
}
