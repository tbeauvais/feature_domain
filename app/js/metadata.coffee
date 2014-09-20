angular.module('sampleDomainApp').factory 'AppMetadata',  ->

  metadata: {pages: [{name: 'Page 1', targets: ['#content_section']}]}

  reset:  ->
    page = this.metadata = {pages: [{name: 'Page 1', targets: ['#content_section']}]}

  get_targets: (pageName) ->
    page = this.get_page(pageName)
    page.targets

  get_page: (pageName) ->
    this.metadata.pages.filter( (page) ->
      pageName == page.name
    )[0]

  get_pages: (pageName) ->
    this.metadata.pages.map (page) ->
      page.name

  add_target: (pageName, target) ->
    page = this.get_page(pageName)
    page.targets.push(target)
