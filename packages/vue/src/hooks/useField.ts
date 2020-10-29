import {
  inject,
  shallowRef,
  reactive,
  watch,
  getCurrentInstance,
  onBeforeUpdate,
  onMounted,
  onBeforeUnmount
} from '@vue/composition-api'
import { isFn, merge } from '@formily/shared'
import { IFieldState, IField, IMutators, LifeCycleTypes } from '@formily/core'
import { getValueFromEvent, inspectChanged } from '../shared'
import { useForceUpdate } from './useForceUpdate'
import { IFieldHook, IFieldStateUIProps } from '../types'
import { FormSymbol } from '../constants'
import { cloneDeep } from 'lodash'

const extendMutators = (
  mutators: IMutators,
  props: IFieldStateUIProps
): IMutators => {
  return {
    ...mutators,
    change: (...args) => {
      args[0] = isFn(props.getValueFromEvent)
        ? props.getValueFromEvent(...args)
        : args[0]
      mutators.change(...args.map(event => getValueFromEvent(event)))
    },
    blur: () => {
      mutators.blur()
      if (props.triggerType === 'onBlur') {
        mutators.validate({ throwErrors: false })
      }
    }
  }
}

const INSPECT_PROPS_KEYS = [
  'props',
  'rules',
  'required',
  'editable',
  'visible',
  'display'
]

export const useField = (_options: IFieldStateUIProps): IFieldHook => {
  const forceUpdate = useForceUpdate()
  const options = cloneDeep(_options) as IFieldStateUIProps
  const reactiveOptions = reactive(_options) as IFieldStateUIProps
  const fieldRef = shallowRef<{
    field: IField
    unmounted: boolean
    subscriberId: number
    uid: symbol
  }>({
    field: null,
    unmounted: false,
    subscriberId: null,
    uid: null
  })
  const form = inject(FormSymbol, null)
  if (!form) {
    throw new Error('Form object cannot be found from context.')
  }

  const createMutators = () => {
    let initialized = false
    fieldRef.value.field = form.registerField(options)
    fieldRef.value.subscriberId = fieldRef.value.field.subscribe(() => {
      if (fieldRef.value.unmounted) return
      /**
       * 同步Field状态只需要forceUpdate一下触发重新渲染，因为字段状态全部代理在formily core内部
       */
      if (initialized) {
        if (options.triggerType === 'onChange') {
          if (fieldRef.value.field.hasChanged('value')) {
            mutators.validate({ throwErrors: false })
          }
        }
        if (!form.isHostRendering()) {
          forceUpdate()
        }
      }
    })
    fieldRef.value.uid = Symbol()
    initialized = true
    return extendMutators(form.createMutators(fieldRef.value.field), options)
  }

  const mutators = createMutators()

  onMounted(() =>
    watch(
      reactiveOptions,
      newOptions => {
        //考虑到组件被unmount，props diff信息会被销毁，导致diff异常，所以需要代理在一个持久引用上
        const cacheProps = fieldRef.value.field.getCache(fieldRef.value.uid)
        if (cacheProps) {
          const props = inspectChanged(
            cacheProps,
            newOptions,
            INSPECT_PROPS_KEYS
          )
          if (props) {
            fieldRef.value.field.setState((state: IFieldState) => {
              merge(state, props, {
                assign: true,
                arrayMerge: (target, source) => source
              })
            })
          }
          fieldRef.value.field.setCache(fieldRef.value.uid, newOptions)
        } else {
          fieldRef.value.field.setCache(fieldRef.value.uid, newOptions)
        }
      },
      { immediate: true, deep: true }
    )
  )

  onMounted(() => {
    fieldRef.value.field.setState(state => {
      state.mounted = true
    }, !fieldRef.value.field.state.unmounted) //must notify,need to trigger restore value
    form.notify(LifeCycleTypes.ON_FIELD_MOUNT, fieldRef.value.field)
    fieldRef.value.unmounted = false
  })

  onBeforeUnmount(() => {
    fieldRef.value.field.removeCache(fieldRef.value.uid)
    fieldRef.value.unmounted = true
    fieldRef.value.field.unsubscribe(fieldRef.value.subscriberId)
    fieldRef.value.field.setState((state: IFieldState) => {
      state.unmounted = true
    }) //must notify,need to trigger remove value
  })

  const state = fieldRef.value.field.getState()

  // TODO: find a way to replace hard code below
  watch([() => options.name, () => options.path], () => {
    const $vm = getCurrentInstance() as any
    $vm.mutators = createMutators()
  })

  onBeforeUpdate(() => {
    // because of "Immer drafts cannot have computed properties", states cann't be reactive
    // so we need to update states in "onBeforeUpdate" hook
    const $vm = getCurrentInstance() as any
    $vm.field = fieldRef.value.field
    $vm.state = fieldRef.value.field.getState()
    $vm.innerProps = $vm.state.props
  })

  return {
    form,
    field: fieldRef.value.field as IField,
    state,
    mutators,
    props: state.props
  }
}

export default useField
