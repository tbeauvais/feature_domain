angular.module('sampleDomainApp').factory 'AppMetadata',  ->

  tree: new TreeModel();

  root: null

  reset:  ->
    @root = null

  getPageTargets: (pageName) ->
    targets = @_getPageTargets(pageName)

    newTargets = []
    @_addTargets(targets.children, newTargets)
    newTargets

  getPages:  ->
    root = @getRoot()

    pages = root.first (node) ->
      node.model.name == 'Pages'

    _.map pages.children, (node)->
      return node.model.name

  addPageTarget: (pageName, target, parent, featureInstanceId) ->
    root = @getRoot()

    page = root.first (node) ->
      node.model.name == pageName

    targets = page.first (node) ->
      node.model.name == 'Targets'

    if parent
      targets = targets.first (node) ->
        node.model.name == parent

    node = @tree.parse({feature_instance_id: featureInstanceId, id: target, name: target})
    if targets
      targets.addChild(node)
    else
      debugger


  getFeatures:  ->
    root = @getRoot()

    root.first (node) ->
      node.model.name == 'Features'

  getFeature: (id)  ->
    features = @getFeatures()

    features.first (node) ->
      node.model.id == id

  getPageNode: (pageName, id) ->
    page = @_getPage(pageName)
    page.first (node) ->
      node.model.feature_instance_id && node.model.feature_instance_id == id

  isChildOfOnPage: (childId, parentId) ->
    feature = @getFeature(childId)
    debugger
    child = @getPageNode(feature.model.page_info.page, childId)
    match = _.find child.getPath(), (node) ->
      return node.model.feature_instance_id == parentId
    !_.isUndefined(match)

  addFeature: (feature)  ->
    features = @getFeatures()
    node = @tree.parse(feature)
    features.addChild(node)
    @addPageTarget(feature.page_info.page, '#' + feature.page_info.id, feature.page_info.target, feature.id)
    node

  getRoot: ->
    if @root == null
      @root = @tree.parse(
        id: "Application"
        name: "Application"
        children: [
          id: "Pages"
          name: "Pages"
          children: [
            id: "Page 1"
            name: "Page 1"
            children: [
              id: "Targets"
              name: "Targets"
              children: [
                id: "#content_section"
                name: "#content_section"
              ]
            ]
          ]
          {
            id: "Features"
            name: "Features"
            children: []
          }
        ]
      )

    @root

  _getPageTargets: (pageName) ->
    page = @_getPage(pageName)
    page.first (node) ->
      node.model.name == 'Targets'

  _getPage: (pageName) ->
    root = @getRoot()

    page = root.first (node) ->
      node.model.name == pageName

  _addTargets: (children, targets) ->
    _.each children, (node) =>
      if node.hasChildren()
        @_addTargets(node.children, targets)
      targets.push(node)
