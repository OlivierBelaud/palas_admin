import { BaseProperty } from './base'

export class DateTimeProperty extends BaseProperty<Date> {
  protected dataType = { name: 'dateTime' as const }
}
