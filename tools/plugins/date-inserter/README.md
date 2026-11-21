# Date Inserter

Do your authors need to insert dates into certain blocks like a countdown clock?  What about the release date of a press release?  Typing the date is easy, but to ensure consistent formatting, selecting one from this lightweight picker is even easier!

- The date defaults to the current local date when the plugin opens.
- Time starts blank and is optional.
- **Insert** inserts the selected date as `YYYY-MM-DD`, with `THH:MM` appended
  when an optional time is provided. Enter in either field also inserts.
- Times are local, with minute precision and no timezone suffix.
- After insertion, the plugin stays open so you can insert additional dates.

## UI

The plugin loads the evergreen [Experience Workspace UI SDK](https://www.aem.live/docs/ew/developing/sdk-ui-components)
and uses `sl-input` for the ISO date field and `sl-button` for insertion,
the calendar's Today and Clear actions, and the time picker's Done and Clear actions. Layout uses
the SDK's Spectrum 2 color, corner, typography, and field tokens.
Typography uses the SDK's font stack with locally available fonts.
The optional time uses a labelled native input styled with the same tokens,
because the SDK currently does not style `type="time"`. Its editable time
segments have Spectrum-style focus treatment. Keyboard entry and 12/24-hour
presentation remain browser-native.

The inset clock button opens a lightweight time popup with the same rounded
panel and circular blue selections as the calendar. Choose an hour, minute
(all 60 minutes are available), and AM/PM, then use Done to apply the time.
Opening the popup or changing its selections does not fill the optional field
until Done is used. Clear removes the time without changing the date. Escape,
tabbing or clicking outside cancels unapplied changes. Arrow keys and Home/End
move within a column; Enter or Space selects a value.

Date and time stay stacked at every window width. The calendar button is inset
inside the date field, and its calendar opens immediately below that field,
before the optional time field.

The date field accepts `YYYY-MM-DD` or a single date selected from the calendar.
Selecting a day fills the field, but does not insert into the document.
Invalid dates disable Insert and display a field error.

Open the calendar with its calendar button. Use arrow keys to move by day/week,
Home/End for the first/last day of the week, Page Up/Down for months, and
Shift+Page Up/Down for years. Enter or Space selects; Escape closes and returns
focus to the calendar button. Today selects the current local date; Clear removes
the date without changing the optional time. Clicking or tabbing outside closes
the calendar. Dates from `0001-01-01` through `9999-12-31` are supported.

Controls initialize after the custom elements are registered. SDK loading and
insertion failures are displayed in the live status area. Experience Workspace documents these
UI components as experimental.


Lint the plugin:

```sh
npx eslint --no-ignore tools/date-inserter/date-inserter.js tools/date-inserter/date-calendar.js tools/date-inserter/time-picker.js
npx stylelint tools/date-inserter/date-inserter.css
```
