angular.module('sampleDomainApp').factory 'AppMetadata',  ->

  tree: new TreeModel();

  root: null

  reset:  ->
    this.root = null

  getPageTargets: (pageName) ->
    targets = this._getPageTargets(pageName)

    newTargets = []
    this._addTargets(targets.children, newTargets)
    newTargets

  getPages:  ->
    root = this.getRoot()

    pages = root.first (node) ->
      node.model.name == 'Pages'

    _.map pages.children, (node)->
      return node.model.name

  addPageTarget: (pageName, target, parent) ->
    root = this.getRoot()

    page = root.first (node) ->
      node.model.name == pageName

    targets = page.first (node) ->
      node.model.name == 'Targets'

    if parent
      targets = targets.first (node) ->
        node.model.name == parent

    node = this.tree.parse({id: target, name: target})
    targets.addChild(node)

  getRoot: ->
    if this.root == null
      this.root = this.tree.parse({id: 'Pages', name: 'Pages', children: [{id: 'Page 1', name: 'Page 1', children: [{id: 'Targets', name: 'Targets', children: [{id: '#content_section', name: '#content_section'}]}]}]})
    this.root

  _getPageTargets: (pageName) ->
    page = this._getPage(pageName)
    page.first (node) ->
      node.model.name == 'Targets'

  _getPage: (pageName) ->
    root = this.getRoot()

    page = root.first (node) ->
      node.model.name == pageName

#  _addTargets: (parent, targets) ->
#    if parent.hasChildren()
#      _.each parent.children, (node) =>
#        if node.hasChildren()
#          this._addTargets(node, targets)
#        else
#          targets.push(node)
#
#    targets.push(parent)

  _addTargets: (children, targets) ->
    _.each children, (node) =>
      if node.hasChildren()
        this._addTargets(node.children, targets)
      targets.push(node)
